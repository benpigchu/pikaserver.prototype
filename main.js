const sublib=require("child_process")
const fs=require("fs")
const util=require("util")

var config={}

try{config=require("./config.json")}catch(err){}

//todo: non-http apps plugin
var sub=sublib.fork("server.js")
process.on("exit",()=>{sub.kill()})
sub.on("exit",(code,signal)=>{console.log("server.js end it's work")})