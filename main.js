const sublib=require("child_process")
const fs=require("fs")
const util=require("util")

var config={}

try{
	fs.accessSync("config.json",fs.R_OK)
	if(fs.statSync("config.json").isFile()){
		config=JSON.parse(fs.readFileSync("config.json","utf-8"))
	}
}catch(err){}
console.log(util.inspect(config))

//todo: non-http apps plugin
var sub=sublib.fork("server.js")
process.on("exit",()=>{sub.kill()})
sub.on("exit",(code,signal)=>{console.log("server.js end it's work")})