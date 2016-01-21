const sublib=require("child_process")

//todo: non-http apps plugin
var sub=sublib.fork("server.js")
process.on("exit",()=>{sub.kill()})
sub.on("exit",(code,signal)=>{console.log("server.js end it's work")})