const sublib=require("child_process")
const fs=require("fs")
const util=require("util")

var config={}

try{config=require("./config.json")}catch(err){}


//todo: non-http apps plugin
var appsConfig=[]
if(config.noneHttpApps!=undefined){appsConfig=config.noneHttpApps}
var apps=[]
appsConfig.forEach((app)=>{
	try{
		var appProcess=sublib.spawn(app.command,app.arg,{stdio:'inherit'})
		apps.push(appProcess)
		appProcess.on("exit",(code,signal)=>{console.log(`${app.name} end it's work`)})
		console.log(`${app.name} loaded`)
	}catch(err){
		console.log(`${app.name} failed to load`)
	}
})

var httpServer=sublib.fork("server.js")
process.on("exit",()=>{
	httpServer.kill()
	apps.forEach((app)=>{
		app.kill()
	})
})
httpServer.on("exit",(code,signal)=>{console.log("server.js end it's work")})