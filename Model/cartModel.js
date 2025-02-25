const mongoose=require("mongoose")
const cartSchema= new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"user",
        required:true

    },
    products:[
        {
            productId:{
                type:mongoose.Schema.Types.ObjectId,
                ref:"product",
                required:true
            },
            quantity:{
                type:Number,
                required:true,
                default: 1 
            },name:{
                type:String,
                required:true
            },
            images: {
                type: [String], 
                required: true
            },
            price:{
                type:Number,
                required:true
            }


    }]
},{timestamps:true});
module.exports =mongoose.model("cart",cartSchema)