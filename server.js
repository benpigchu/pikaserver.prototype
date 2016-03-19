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

const defaultErrorMessage={
	"400":"pikaServiceError:bad request\n",
	"404":"pikaServiceError:file not found\n",
	"500":"pikaServiceError:server code error\n"
}

const serverStartTime=new Date()

var config={}

try{config=require("./config.json")}catch(err){}

var hostname=defaultHostname
var port=defaultPort
var staticPath=defaultStaticPath
var errorMessage={}
var errorPage={}
var appsConfigList=[]
var staticRedirection=[]
var staticRangeRedirection=[]
var staticRangeRejection=[]
var staticLinking=[]
var domainSetting={}

if(config.serviceAddress!=undefined){hostname=config.serviceAddress}
if(config.httpServicePort!=undefined){port=config.httpServicePort}
if(config.staticPath!=undefined){staticPath=config.staticPath}
if(config.errorMessage!=undefined){errorMessage=config.errorMessage}
if(config.errorPage!=undefined){errorPage=config.errorPage}
if(config.httpApps!=undefined){appsConfigList=config.httpApps}
if(config.staticRedirection!=undefined){staticRedirection=config.staticRedirection}
if(config.staticRangeRedirection!=undefined){staticRangeRedirection=config.staticRangeRedirection}
if(config.staticRangeRejection!=undefined){staticRangeRejection=config.staticRangeRejection}
if(config.staticLinking!=undefined){staticLinking=config.staticLinking}
if(config.domainSetting!=undefined){domainSetting=config.domainSetting}


const generateApps=function(config,domain){
	var appList=[]
	config.forEach((appConfig)=>{
		var app={
			name:appConfig.name,
			pathPrefix:appConfig.pathPrefix,
			method:(req,res,reqId)=>{
				console.log(`---- [${reqId}]undefined app method`)
				sendError(req,res,500,reqId)
			}
		}
		var appPath=appConfig.file
		if(appPath[0]!="/"){appPath="./"+appPath}
		try{
			var appMethod=require(appPath)
			if(!(appMethod instanceof Function)){throw TypeError}
			app.method=appMethod
		}catch(err){}
		appList.push(app)
		console.log(`-- loaded http app: ${app.name} under ${domain}`)
	})
	return appList
}

var apps=generateApps(appsConfigList,"default domain")

for(var domain in domainSetting){
	if(domainSetting[domain].staticPath==undefined){domainSetting[domain].staticPath=defaultStaticPath}
	if(domainSetting[domain].errorMessage==undefined){domainSetting[domain].errorMessage={}}
	if(domainSetting[domain].errorPage==undefined){domainSetting[domain].errorPage={}}
	if(domainSetting[domain].httpApps==undefined){domainSetting[domain].httpApps=[]}
	if(domainSetting[domain].staticRedirection==undefined){domainSetting[domain].staticRedirection=[]}
	if(domainSetting[domain].staticRangeRedirection==undefined){domainSetting[domain].staticRangeRedirection=[]}
	if(domainSetting[domain].staticRangeRejection==undefined){domainSetting[domain].staticRangeRejection=[]}
	if(domainSetting[domain].staticLinking==undefined){domainSetting[domain].staticLinking=[]}
	domainSetting[domain].apps=generateApps(domainSetting[domain].httpApps,domain)
}

const sendError=(req,res,code,reqId)=>{
	var domain=req.headers[Host]
	var messages=errorMessage
	var pages=errorPage
	if(domain in domainSetting){
		messages=domainSetting[domain].errorMessage
		pages=domainSetting[domain].errorPage
	}
	var sendErrorMessage=()=>{		
		res.writeHead(code,{"Content-Type":"text/plain"})
		if(code in messages){
			res.end(messages[code])
		}else{
			res.end(defaultErrorMessage[code])
		}
	}
	if(code in pages){
		fs.access(pages[code],fs.R_OK,(err)=>{
			if(err){
				sendErrorMessage()
			}else{
				fs.stat(pages[code],(err,stats)=>{
					if(err){
						sendErrorMessage()
					}else if(!stats.isFile()){
						sendErrorMessage()
					}else{
						if(mimetype[path.extname(pages[code])]!=undefined){
							res.setHeader("Content-Type",mimetype[path.extname(pages[code])])						
						}
						var encode
						if(req.headers['accept-encoding']!=undefined){
							encode=req.headers['accept-encoding'].split(", ")
						}else{
							encode=[]
						}
						var rs=fs.createReadStream(pages[code])
						if(encode.indexOf("gzip")!=-1){
							res.writeHead(code,{'Content-Encoding':'gzip'})
							console.log(`---- [${reqId}]use gzip`)
							rs.pipe(zlib.createGzip()).pipe(res)
						}else if(encode.indexOf("deflate")!=-1){
							res.writeHead(code,{'Content-Encoding':'deflate'})
							console.log(`---- [${reqId}]use deflate`)
							rs.pipe(zlib.createDeflate()).pipe(res)
						}else{
							console.log(`---- [${reqId}]use raw`)		
							res.writeHead(code)
							rs.pipe(res)
						}
					}
				})
			}
		})
	}else{
		sendErrorMessage()
	}
	console.log(`---- [${reqId}]${code} sent`)
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
	var encode
	if(req.headers['accept-encoding']!=undefined){
		encode=req.headers['accept-encoding'].split(", ")
	}else{
		encode=[]
	}
	console.log(`---- [${reqId}]supported encoding: ${encode}`)
	var rs=fs.createReadStream(filePath)
	if(encode.indexOf("gzip")!=-1){
		res.writeHead(200,{'Content-Encoding':'gzip'})
		console.log(`---- [${reqId}]use gzip`)
		rs.pipe(zlib.createGzip()).pipe(res)
	}else if(encode.indexOf("deflate")!=-1){
		res.writeHead(200,{'Content-Encoding':'deflate'})
		console.log(`---- [${reqId}]use deflate`)
		rs.pipe(zlib.createDeflate()).pipe(res)
	}else{
		console.log(`---- [${reqId}]use raw`)		
		res.writeHead(200)
		rs.pipe(res)
	}
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
			sendError(req,res,404,reqId)
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
	var filePath
	var isJumped=false
	for(var i=0;i<staticLinking.length;i++){
		var begin=staticLinking[i].from
		if(begin[begin.length-1]!="/"){begin+="/"}
		if((reqPath+"/").slice(0,begin.length)==begin){
			filePath=path.normalize(path.join(staticLinking[i].to,reqPath.slice(staticLinking[i].from.length)))
			isJumped=true
			break
		}
	}
	if(!isJumped){
		if(reqPath[reqPath.length-1]=="/"){
			reqPath=reqPath.slice(0,reqPath.length-1)
		}
		filePath=path.normalize(path.join(staticPath,reqPath))
	}
	console.log(`---- [${reqId}]ask for ${filePath}`)
	fs.access(filePath,fs.R_OK,(err)=>{
		if(err){
			console.log(`---- [${reqId}]not found`)
			sendError(req,res,404,reqId)
		}else{
			fs.stat(filePath,(err,stats)=>{
				if(stats.isDirectory()){
					console.log(`---- [${reqId}]it is a directory`)
					var rawReq=decodeURIComponent(reqUrl.pathname)
					if(rawReq[rawReq.length-1]!="/"){
						console.log(`---- [${reqId}]req do not end with '/'`)
						res.writeHead(301,{"Location":reqUrl.pathname+"/"})
						res.end()
						return
					}
					filePath=path.normalize(path.join(filePath,"/index.html"))
					console.log(`---- [${reqId}]check ${filePath} instead`)
					fs.access(filePath,fs.R_OK,(err)=>{
						if(err){
							console.log(`---- [${reqId}]not found`)
							sendError(req,res,404,reqId)
						}else{
							fs.stat(filePath,(err,stats)=>{
								if(!err&&stats.isFile()){
									console.log(`---- [${reqId}]found`)
									sendFile(req,res,filePath,stats,reqId)
								}else{
									console.log(`---- [${reqId}]not found`)
									sendError(req,res,404,reqId)
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

var reqNum=0

const listenProcess=(req,res)=>{
	var reqId=Date.now()+reqNum
	reqNum++
	console.log(`-- [${reqId}]request heared at ${new Date()}`)
	var reqUrl=url.parse(req.url)
	console.log(`---- [${reqId}]ask for ${reqUrl.pathname} with ${reqUrl.search} and ${reqUrl.hash}`)
	var reqPath=decodeURIComponent(reqUrl.pathname)
	if(reqPath.match(/\.\./)!=null){
		console.log(`---- [${reqId}]bad request: including '..' `)
		sendError(req,res,400,reqId)
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
}

http.createServer(listenProcess).listen(port,hostname,()=>{
	console.log(`-- pikaService running at http://${hostname}:${port}/`)
});