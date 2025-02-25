
const mongoose = require("mongoose");
const User = require("../Model/usermodel")
const Products = require("../Model/productModel")
const Address = require("../Model/addresModel")
const Cart = require("../Model/cartModel")
const Order = require("../Model/orderModel")
const Wallet = require("../Model/walletModel")
const HttpStatusCodes = require("../config/httpStatusCode");
require('dotenv').config();


// user order controllr and    checkout stars 


const loadCheckOut = async (req, res) => {
  const userId = req.session.userId
  const cartCount = req.session.cartCount

  if (!userId) {
    return res.redirect("/login")
  }



  try {
    const userCart = await Cart.findOne({ userId }).populate("products.productId");
    const savedAddresses = await Address.find({ user: userId })

    if (!userCart || !userCart.products || userCart.products.length === 0) {
      req.session.message = "Your cart is empty. Please add products to proceed.";
      return res.redirect("/cart");
    }

    for (let item of userCart.products) {
      if (item.quantity > item.productId.stock) {
        req.session.message = `The requested quantity for "${item.productId.name}" exceeds the available stock. Please adjust your cart.`;
        req.session.coupon = null
        console.log("Coupon cleared");
        return res.redirect("/cart");
        // return res.status(400).send("invalis quanityt")
      }
    }



    let subtotal = 0;
    userCart.products.forEach(item => {
      const productPrice = item.productId.discountPrice || item.productId.price;
      subtotal += productPrice * item.quantity;
    });



    let discountAmount = 0;
    let newTotal = 0;
    let couponDetails = null;
    const shippingCharge = 100

    if (req.session.newTotal) {
      newTotal = req.session.newTotal;
    } else {
      newTotal = subtotal
    }

    if (req.session.coupon) {
      const coupon = req.session.coupon;

      couponDetails = {
        code: coupon.code,
        type: coupon.discountType,
        value: coupon.discountValue
      };
      if (coupon.discountType === 'percentage') {
        discountAmount = (subtotal * coupon.discountValue) / 100;
      } else if (coupon.discountType === 'fixed') {
        discountAmount = coupon.discountValue;
      }


      discountAmount = Math.min(discountAmount, subtotal);
      newTotal = newTotal - discountAmount;
    }


    newTotal += shippingCharge;
    const order = {
      products: userCart.products,
      subtotal: subtotal,
      total: newTotal,
      discountAmount: discountAmount,
      couponDetails: couponDetails
    };

    res.render("user/chekout", {
      savedAddresses, order,
      message: req.session.message,
      cartCount,

    });
    req.session.message = null;



  } catch (error) {
    console.error("Error loading checkout:", error);
  }

}

const defaultAddress = async (req, res) => {
  const addressId = req.params.id
  const userId = req.session.userId


  try {

    await Address.updateMany({ user: userId }, { isDefault: false })

    await Address.findByIdAndUpdate(addressId, { isDefault: true })

  } catch (error) {
    console.error('Error setting default address:', error);
    return res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error inn' });
  }
}


const saveBillingAddress = async (req, res) => {
  const userId = req.session.userId;
  const { firstName, lastName, email, mobile, addressLine, city, state, pinCode, country } = req.body;

  const errors = [];

  if (!firstName) errors.push({ field: "firstName", message: "First name is required" });
  if (!lastName) errors.push({ field: "lastName", message: "Last name is required" });
  if (!addressLine) errors.push({ field: "addressLine", message: "Address line is required" });
  if (!city) errors.push({ field: "city", message: "City is required" });
  if (!state) errors.push({ field: "state", message: "State is required" });
  if (!country) errors.push({ field: "country", message: "Country is required" });
  if (firstName && firstName.length < 2) errors.push({ field: "firstName", message: "First name must be at least 2 characters long" });
  if (lastName && lastName.length < 2) errors.push({ field: "lastName", message: "Last name must be at least 2 characters long" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: "email", message: "Invalid email format" });
  if (!/^[0-9]{10}$/.test(mobile)) errors.push({ field: "mobile", message: "Mobile number must be 10 digits" });
  if (addressLine && addressLine.length < 5) errors.push({ field: "addressLine", message: "Address must be at least 5 characters long" });
  if (!/^[0-9]{6}$/.test(pinCode)) errors.push({ field: "pinCode", message: "Pin code must be 6 digits" });

  if (errors.length > 0) {
      return res.status(400).json({ errors });
  }

  try {
      const newAddress = new Address({
          user: userId,
          firstName,
          lastName,
          email,
          mobile,
          addressLine,
          city,
          state,
          pinCode,
          country
      });

      await newAddress.save();
      return res.status(200).json({ success: true });
  } catch (error) {
      console.error('Error saving address:', error);
      return res.status(500).json({ error: 'Failed to save address' });
  }
};



const placeOrder = async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }
  try {
    const objectId = new mongoose.Types.ObjectId(userId);
    let { addressId, paymentMethod } = req.body;

    if (!addressId) {
      const defaultAddress = await Address.findOne({ user: objectId, isDefault: true });


      if (!defaultAddress) {
        req.session.message = "Select a Address";
        return res.redirect("/checkOut")
      }
      addressId = defaultAddress._id;
    }

    const cart = await Cart.findOne({ userId: objectId }).populate('products.productId');
    if (!cart || cart.products.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }
    const shippingCharge = 100
    let totalAmount = 0;
    let totalDiscount = 0;
    let products = [];
    let price;
    let couponDetails = null

    for (let item of cart.products) {
      const product = await Products.findById(item.productId._id);

      if (product.stock < item.quantity) {
        req.session.message = `Insufficient stock for ${product.name}.`;
        return res.redirect("/checkOut");
      }


      price = product.discountPrice > 0 ? product.discountPrice : product.price;
      totalDiscount += (product.price - price) * item.quantity;
      totalAmount += price * item.quantity;

      product.stock -= item.quantity;
      await product.save();

      products.push({
        productId: product._id,
        quantity: item.quantity,
        name: product.name,
        price: price
      });
    }
    totalAmount += shippingCharge


    if (req.session.coupon) {
      const coupon = req.session.coupon;
      couponDetails = {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue
      };
    }

    if (paymentMethod === "no value") {
      req.session.message = "Select a payment method.";
      return res.redirect("/checkOut");
    }

    if (paymentMethod === "CashOnDelivery" && totalAmount >= 3000) {
      req.session.message = "Cash on Delivery is not available for orders above ₹3000.";
      return res.redirect("/checkOut");
    }

    if (paymentMethod === "Wallet") {
      const user = await User.findById(userId)
      if (user.walletBalance < totalAmount) {
        req.session.message = "Insufficient wallet balance.";
        return res.redirect("/checkOut");
      }
      user.walletBalance -= totalAmount
      await user.save()

      const walletTransaction = new Wallet({
        userId,
        amount: totalAmount,
        transactionType: "Debit",
        description: " Payment for Order"
      })
      await walletTransaction.save()
    }

    let paymentStatus="Pending"
    if(paymentMethod==="Wallet"){
     paymentStatus="Paid"
    }

    const newOrder = new Order({
      userId: objectId,
      products,
      address: addressId,
      total: totalAmount,
      status: "Pending",
      paymentMethod,
      discountAmount: totalDiscount,
      coupon: couponDetails,
      paymentStatus:paymentStatus
    });

  

    await newOrder.save();
    await Cart.updateOne({ userId: objectId }, { products: [] });
    req.session.coupon = null;


    return res.redirect("/thankyou");
  } catch (error) {
    console.error('Error placing order:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};



//  hrere

const thankyou = async (req, res) => {
  req.session.newTotal = null
  req.session.coupon = null;
  res.render("user/thankyou")
}


const orderHistory = async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    res.redirect("/login")
  }

  try {
    const orders = await Order.find({ userId: userId }).populate('products.productId').sort({ createdAt: -1 });

    if (!orders || orders.length === 0) {
      req.session.message = "No orders found";
      return res.redirect("/profile");
    }

    res.render("user/orderHistory", {
      orders,
      message: req.session.message
    })
    req.session.message = null;

  } catch (error) {
    console.error("Error fetching order history:", error);
    return res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal server error" });
  }
}


const cancelOrder = async (req, res) => {
  const userId = req.session.userId;
  const orderId = req.params.orderId;
  const productId = req.params.productId;
  const reason=req.body.reason


  if (!userId) {
    return res.redirect('/login');
  }


 
  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }


    const product = order.products.find(
      (product) => product._id.toString() === productId.toString()
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found in order' });
    }

    if(reason){
      order.reason.cancelReason=reason
    }

    if (product.singleStatus === 'Cancelled') {
      return res.status(404).json({ message: 'Product already cancelled' });
    }

    product.singleStatus = 'Cancelled';

    const singleProduct = await Products.findByIdAndUpdate(
      product.productId,
      { $inc: { stock: product.quantity } },
      { new: true }
    );

    const allCancelled = order.products.every((p) => p.singleStatus === 'Cancelled');
    if (allCancelled) {
      order.status = 'Cancelled';
    }

    if (order.paymentMethod === 'Razorpay') {
      const refundAmount = product.price * product.quantity;

      const walletTransaction = new Wallet({
        userId,
        amount: refundAmount,
        transactionType: 'Credit',
        description: `Refund for cancelled product in order`,
      });
      await walletTransaction.save();

      user.walletBalance += refundAmount;
      await user.save();
    }

    await order.save();

    // res.redirect('/profile/orders');
    return res.json({sucsess:true})
  } catch (error) {
    console.error('Error in cancel order:', error);
    res.status(500).json({ message: 'An error occurred while cancelling the order' });
  }
};


const returnorder = async (req, res) => {
  const orderId = req.params.orderId;
  const productId = req.params.productId;
  const reason=req.body.reason
 
  
  try {
    const order = await Order.findById(orderId).populate('products.productId');
    if (!order) {
      req.session.message = "No orders found";
      return res.redirect("/profile/orders");
    }

    const product = order.products.find(
      (product) => product._id.toString() === productId.toString()
    );

    if (!product) {
      req.session.message = "Product not found in the order";
      return res.redirect("/profile/orders");
    }

    if (product.singleStatus !== "Delivered") {
      req.session.message = "Product is not delivered yet, cannot return";
      return res.redirect("/profile/orders");
    }
    if(reason){
       order.reason.returnReason=reason
    }

    product.singleStatus = "Returned";

    product.productId.stock += product.quantity;

    const refundAmount = product.productId.discountPrice
      ? product.productId.discountPrice * product.quantity
      : product.productId.price * product.quantity;

    const walletTransaction = new Wallet({
      userId: order.userId,
      amount: refundAmount,
      transactionType: 'Credit',
      description: `Refund for returned product: ${product.productId.name}`,
    });

    await walletTransaction.save();

    const user = await User.findById(order.userId);
    user.walletBalance += refundAmount;
    await user.save();
    const allReturned = order.products.every((p) => p.singleStatus === 'Returned');
    if (allReturned) {
      order.status = 'Returned';
    }
    await order.save();
   return res.status(HttpStatusCodes.OK).json({success:true})
  } catch (error) {
    console.error("Error in return order:", error);

    if (!res.headersSent) {
      return res.status(500).json({ message: "An error occurred while processing the return" });
    }
  }
};

function randomDeliveryDate(date) {
  const orderdate = new Date(date)
  const randomDays = Math.floor(Math.random() * 10) + 1;
  const deliveryDate = new Date(orderdate)
  deliveryDate.setDate(orderdate.getDate() + randomDays)
  return deliveryDate
}

const orderDetails = async (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.userId;

  try {

    const order = await Order.findOne({ _id: orderId, userId })
      .populate('products.productId')
      .populate('address');

    const createdAt = order.createdAt
    const deliveryDate = randomDeliveryDate(createdAt)
    if (!order) {
      return res.status(HttpStatusCodes.NOT_FOUND).render("user/orderDetails", { message: "Order not found or access denied" });

    }
    res.render("user/orderDetails", { order, deliveryDate, couponDetails: order.coupon });
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).send("Server error");
  }
};


//user order conrrollwe and chekout ends


//admin order controller starts


const loadOrder = async (req, res) => {
  try {

    
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 11;
    const skip = (page - 1) * limit;

    // Fetch total number of categories
    const totalOrders = await Order.countDocuments(); // Get total number of categories


    const orders = await Order.find()
      .populate('userId', 'username')
      .populate('address')
      .populate('products.productId', 'name price')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })


    const totalPages = Math.ceil(totalOrders / limit);
    const previousPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;

    if (!orders || orders.length === 0) {
      return res.status(HttpStatusCodes.NOT_FOUND).send("No orders found");
    }


    res.render("admin/orderManagement", {
      orders: orders,
      currentPage: page,
      totalPages: totalPages,
      totalOrders: totalOrders,
      previousPage: previousPage,
      nextPage: nextPage
    });



  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'An error occurred while fetching orders.' });
  }

}

const serchOrder = async (req, res) => {
  const searchItem = req.query.search || "";

  try {

    const regex = new RegExp(searchItem, "i");

    const query = {
      $or: [
        { "userId.username": { $regex: regex } },
        { status: { $regex: regex } },
        { "products.name": { $regex: regex } }
      ]
    };

    const orders = await Order.find(query).populate('userId').populate('products.productId');
    res.render("admin/orderManagement", { orders, searchItem });
  } catch (error) {
    console.error("Error in search orders:", error);
    res.status(500).json({ message: "An error occurred while searching for orders." });
  }
};


const orderStatus = async (req, res) => {
  const orderId = req.params.id
  const newStatus = req.body.status


  try {

    const order = await Order.findById(orderId)
    if (!order) {
      return res.status(HttpStatusCodes.NOT_FOUND).json({ message: 'Order not found' });
    }
    order.status = newStatus

    if(order.paymentMethod ==="CashOnDelivery" && newStatus==="Delivered"){
      order.paymentStatus="Paid"
    }

    order.products.map(product => {
      product.singleStatus = newStatus
    })

    await order.save()


    res.redirect("/admin/orderManagement")
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'An error occurred while updating the order status.' });

  }

}

const admincancelOrder = async (req, res) => {
  const orderId = req.params.id
  try {
    // const order = await Order.findByIdAndUpdate(orderId, { status: "Cancelled" })
    const order = await Order.findById(orderId)

    if (!order) {
      res.status(HttpStatusCodes.BAD_REQUEST).json({ message: "Order nor found" })
    }

    order.products.forEach(product => {
      product.singleStatus = "Cancelled"
    })
    order.status = "Cancelled"
    await order.save()
    console.log(order)

    res.redirect("/admin/orderManagement")
  } catch (error) {
    console.error("error in cancel order form admin side")
    res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({ message: "error in canceling order in admin side " })
  }
}

//admin ordercontrollerr ends 

module.exports = {
  loadCheckOut,
  defaultAddress,
  saveBillingAddress,
  placeOrder,
  thankyou,
  orderHistory,
  cancelOrder,
  orderDetails,
  loadOrder,
  serchOrder,
  orderStatus,
  admincancelOrder,
  returnorder,

}