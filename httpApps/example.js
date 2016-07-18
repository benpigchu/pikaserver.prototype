const http=require("http")
const fs=require("fs")
const url=require("url")
const path=require("path")
const util=require("util")

module.exports.callback=(req,res,reqId)=>{
	res.writeHead(200,{"Content-Type":"text/plain"})
	res.end(url.parse(req.url).search)
	console. log(`---- [${reqId}]querystring sent`)
}