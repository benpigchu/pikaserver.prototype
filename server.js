const http=require("http")
const fs=require("fs")
const url=require("url")
const path=require("path")
const util=require("util")

const defaultHostname="0.0.0.0"
const defaultPort=80
const defaultStaticPath="/home/user/static/"

var config={}

try{
	fs.accessSync("config.json",fs.R_OK)
	if(fs.statSync("config.json").isFile()){
		config=JSON.parse(fs.readFileSync("config.json","utf-8"))
	}
}catch(err){}
console.log(util.inspect(config))

var hostname=defaultHostname
var port=defaultPort
var staticPath=defaultStaticPath

if(config.serviceAddress!=undefined){hostname=config.serviceAddress}
if(config.httpServicePort!=undefined){port=config.httpServicePort}
if(config.staticPath!=undefined){staticPath=config.staticPath}

const staticFileReturner=(req,res)=>{
	var reqUrl=url.parse(req.url)
	var reqPath=decodeURIComponent(reqUrl.pathname)
	if(reqPath.match(/\.\./)!=null){
		console.log("---- bad request: including '..' ")
		res.writeHead(400,{"Content-Type":"text/plain"})
		res.end("pikaServiceError:bad request\n")
		console.log("---- 400 sent")
		return
	}
	var filePath=path.normalize(path.join(staticPath,reqPath))
	console.log(`---- ask for ${filePath}`)
	fs.access(filePath,fs.R_OK,(err)=>{
		if(err){
			console.log("---- not found")
			res.writeHead(404,{"Content-Type":"text/plain"})
			res.end("pikaServiceError:file not found\n")
			console.log("---- 404 sent")
		}else{
			fs.stat(filePath,(err,stats)=>{
				if(stats.isDirectory()){
					console.log("---- it is a directory")
					filePath=path.normalize(path.join(filePath,"/index.html"))
					console.log(`---- check ${filePath} instead`)
					fs.access(filePath,fs.R_OK,(err)=>{
						if(err){
							console.log("---- not found")
							res.writeHead(404,{"Content-Type":"text/plain"})
							res.end("pikaServiceError:file not found\n")
							console.log("---- 404 sent")
						}else{
							fs.stat(filePath,(err,stats)=>{
								if(!err&&stats.isFile()){
									console.log("---- found")
									var ifModifiedAfter=req.headers["if-modified-since"]
									console.log(`---- ask: if modified after ${util.inspect(ifModifiedAfter)}(${Date.parse(ifModifiedAfter)})`)
									console.log(`---- last modified at ${stats.mtime}(${stats.mtime.getTime()})`)
									if(ifModifiedAfter!=undefined){
										if(stats.mtime.getTime()-Date.parse(ifModifiedAfter)<=999){//why 999? because http can only use s but ms to transport time in header
											console.log("---- not modified")
											res.writeHead(304,{"Last-Modified":stats.mtime})
											res.end()
											console.log("---- 304 sent")
											return
										}
									}
									console.log("---- modified")
									res.writeHead(200,{"Last-Modified":stats.mtime})
									var rs=fs.createReadStream(filePath)
									rs.pipe(res)
									console.log("---- file sent")
								}else{
									console.log("---- not found")
									res.writeHead(404,{"Content-Type":"text/plain"})
									res.end("pikaServiceError:file not found\n")
									console.log("---- 404 sent")
								}
							})
						}
					})
				}else{
					console.log("---- found")
					var ifModifiedAfter=req.headers["if-modified-since"]
					console.log(`---- ask: if modified after ${util.inspect(ifModifiedAfter)}(${Date.parse(ifModifiedAfter)})`)
					console.log(`---- last modified at ${stats.mtime}(${stats.mtime.getTime()})`)
					if(ifModifiedAfter!=undefined){
						if(stats.mtime.getTime()-Date.parse(ifModifiedAfter)<=999){//also here
							console.log("---- not modified")
							res.writeHead(304,{"Last-Modified":stats.mtime})
							res.end()
							console.log("---- 304 sent")
							return
						}
					}
					console.log("---- modified")
					res.writeHead(200,{"Last-Modified":stats.mtime})
					var rs=fs.createReadStream(filePath)
					rs.pipe(res)
					console.log("---- file sent")
				}
			})
		}
	})
}

http.createServer((req,res)=>{
	console.log("-- request heared")
	//todo: http apps plugin
	staticFileReturner(req,res)
}).listen(port,hostname,()=>{
	console.log(`-- pikaService running at http://${hostname}:${port}/`)
});