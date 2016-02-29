const http=require("http")
const fs=require("fs")
const url=require("url")
const path=require("path")
const util=require("util")
const zlib=require("zlib")

const defaultHostname="0.0.0.0"
const defaultPort=80
const defaultStaticPath="/home/user/static/"

const mimetype={
	".html":"text/html",
	".css":"text/css",
	".js":"application/javascript",
	".json":"application/json",
	".svg":"image/svg+xml",
	".png":"image/png",
	".jpg":"image/jpeg",
	".jpeg":"image/jpg",
	".gif":"image/gif",
	".ico":"image/vnd.microsoft.icon"
}

const serverStartTime=new Date()

var config={}

try{config=require("./config.json")}catch(err){}

var hostname=defaultHostname
var port=defaultPort
var staticPath=defaultStaticPath
var appsConfigList=[]
var staticRedirection=[]
var staticRangeRedirection=[]
var staticRangeRejection=[]

if(config.serviceAddress!=undefined){hostname=config.serviceAddress}
if(config.httpServicePort!=undefined){port=config.httpServicePort}
if(config.staticPath!=undefined){staticPath=config.staticPath}
if(config.httpApps!=undefined){appsConfigList=config.httpApps}
if(config.staticRedirection!=undefined){staticRedirection=config.staticRedirection}
if(config.staticRangeRedirection!=undefined){staticRangeRedirection=config.staticRangeRedirection}
if(config.staticRangeRejection!=undefined){staticRangeRejection=config.staticRangeRejection}

const send404=(req,res,reqId)=>{
	res.writeHead(404,{"Content-Type":"text/plain"})
	res.end("pikaServiceError:file not found\n")
	console.log(`---- [${reqId}]404 sent`)
}

const sendFile=(req,res,filePath,stats,reqId)=>{
	var returnMTime=stats.mtime.getTime()<serverStartTime.getTime()?serverStartTime.toUTCString():stats.mtime.toUTCString()
	var ifModifiedAfter=req.headers["if-modified-since"]
	console.log(`---- [${reqId}]ask: if modified after ${util.inspect(ifModifiedAfter)}(${Date.parse(ifModifiedAfter)})`)
	console.log(`---- [${reqId}]last modified at ${stats.mtime}(${stats.mtime.getTime()})`)
	if(ifModifiedAfter!=undefined){
		if((stats.mtime.getTime()-Date.parse(ifModifiedAfter)<=999)&&(serverStartTime.getTime()-Date.parse(ifModifiedAfter)<=999)){//why 999? because http can only use s but ms to transport time in header
			console.log(`---- [${reqId}]not modified`)
			res.writeHead(304,{"Last-Modified":returnMTime})
			res.end()
			console.log(`---- [${reqId}]304 sent`)
			return
		}
	}
	console.log(`---- [${reqId}]modified`)
	if(mimetype[path.extname(filePath)]!=undefined){
		res.setHeader("Content-Type",mimetype[path.extname(filePath)])						
	}
	res.setHeader("Last-Modified",returnMTime)
	var rs=fs.createReadStream(filePath)
	res.writeHead(200)
	rs.pipe(res)
	console.log(`---- [${reqId}]file sent`)
}

const staticFileReturner=(req,res,reqId)=>{
	var reqUrl=url.parse(req.url)
	var reqPath=decodeURIComponent(reqUrl.pathname)
	for(var i=0;i<staticRangeRejection.length;i++){
		var begin=staticRangeRejection[i]
		if(begin[begin.length-1]!="/"){begin+="/"}
		if((reqPath+"/").slice(0,begin.length)==begin){
			console.log(`---- [${reqId}]reject, send404`)
			send404(req,res,reqId)
			return
		}
	}
	for(var i=0;i<staticRedirection.length;i++){
		var begin=staticRedirection[i].from
		if(begin[begin.length-1]!="/"){begin+="/"}
		if((reqPath+"/").slice(0,begin.length)==begin){
			reqPath=staticRedirection[i].to+reqPath.slice(staticRedirection[i].from.length)
			console.log(`---- [${reqId}]redirect to ${reqPath}`)
			break
		}
	}
	for(var i=0;i<staticRangeRedirection.length;i++){
		var begin=staticRangeRedirection[i].from
		if(begin[begin.length-1]!="/"){begin+="/"}
		if((reqPath+"/").slice(0,begin.length)==begin){
			reqPath=staticRangeRedirection[i].to
			console.log(`---- [${reqId}]redirect to ${reqPath}`)
			break
		}
	}
	var filePath=path.normalize(path.join(staticPath,reqPath))
	console.log(`---- [${reqId}]ask for ${filePath}`)
	fs.access(filePath,fs.R_OK,(err)=>{
		if(err){
			console.log(`---- [${reqId}]not found`)
			send404(req,res,reqId)
		}else{
			fs.stat(filePath,(err,stats)=>{
				if(stats.isDirectory()){
					console.log(`---- [${reqId}]it is a directory`)
					filePath=path.normalize(path.join(filePath,"/index.html"))
					console.log(`---- [${reqId}]check ${filePath} instead`)
					fs.access(filePath,fs.R_OK,(err)=>{
						if(err){
							console.log(`---- [${reqId}]not found`)
							send404(req,res,reqId)
						}else{
							fs.stat(filePath,(err,stats)=>{
								if(!err&&stats.isFile()){
									console.log(`---- [${reqId}]found`)
									sendFile(req,res,filePath,stats,reqId)
								}else{
									console.log(`---- [${reqId}]not found`)
									send404(req,res,reqId)
								}
							})
						}
					})
				}else{
					console.log(`---- [${reqId}]found`)
					sendFile(req,res,filePath,stats,reqId)
				}
			})
		}
	})
}

var apps=[]

for (var i=0;i<appsConfigList.length;i++){
	var app={
		name:appsConfigList[i].name,
		pathPrefix:appsConfigList[i].pathPrefix,
		method:(req,res,reqId)=>{
			console.log(`---- [${reqId}]undefined app method`)
			res.writeHead(500,{"Content-Type":"text/plain"})
			res.end("pikaServiceError: undefined server behavior\n")
			console.log(`---- [${reqId}]500 sent`)
		}
	}
	var appPath=appsConfigList[i].file
	if(appPath[0]!="/"){appPath="./"+appPath}
	try{
		var appMethod=require(appPath)
		if(!(appMethod instanceof Function)){throw TypeError}
		app.method=appMethod
	}catch(err){}
	apps.push(app)
	console.log(`-- loaded http app: ${apps[i].name}`)
}

var reqNum=0

http.createServer((req,res)=>{
	util.inspect(req.headers['accept-encoding'])
	var reqId=Date.now()+reqNum
	reqNum++
	console.log(`-- [${reqId}]request heared at${new Date()}`)
	var reqUrl=url.parse(req.url)
	console.log(`---- [${reqId}]ask for ${reqUrl.pathname} with ${reqUrl.search} and ${reqUrl.hash}`)
	var reqPath=decodeURIComponent(reqUrl.pathname)
	if(reqPath.match(/\.\./)!=null){
		console.log(`---- [${reqId}]bad request: including '..' `)
		res.writeHead(400,{"Content-Type":"text/plain"})
		res.end("pikaServiceError:bad request\n")
		console.log(`---- [${reqId}]400 sent`)
		return
	}
	for (var i=0;i<apps.length;i++){
		if((reqPath+"/").slice(0,apps[i].pathPrefix.length)==apps[i].pathPrefix){
			console.log(`---- [${reqId}]use app: ${apps[i].name}`)
			apps[i].method(req,res,reqId)
			return
		}
	}
	staticFileReturner(req,res,reqId)
}).listen(port,hostname,()=>{
	console.log(`-- pikaService running at http://${hostname}:${port}/`)
});