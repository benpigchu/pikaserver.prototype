const fs=require("fs")
const url=require("url")
const path=require("path")
const util=require("util")
const zlib=require("zlib")
const http=require("http")
const http2=require("http2")
const child=require("child_process")

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
	".ico":"image/vnd.microsoft.icon",
	".rss":"application/rss+xml"
}
const defaultErrorMessage={
	400:"pikaServiceError: bad request\n",
	404:"pikaServiceError: not found\n",
	500:"pikaServiceError: internal server error\n"
}

const serverStartTime=new Date()

const getConfig=()=>{
	let config={}
	try{
		let configPath=process.argv[2]?path.resolve(process.cwd(),process.argv[2]):"./config.json"
		config=require(process.argv[2]||"./config.json")
	}catch(err){
		console.log(`Warning: ${err.message}`)
		console.log(`Warning: use default config`)
	}
	return config
}
const config=getConfig()
const{host="::",port:httpPort="80",basePath="/home/user/static/",https={},actions:actionsSchema=[],plugins=[],errorMessage,errorPage}=config
const{open:httpsOpen=false,hsts=true,port:httpsPort="443",key="",cert="",renew={}}=https
const{open:renewOpen=false,period:renewPeriod=1728000000,command:renewCommand=""}=renew

const encoders=[{name:"gzip",builder:()=>zlib.createGzip()},{name:"deflate",builder:()=>zlib.createDeflate()}]

const serveStream=async(context,stream,code)=>{
	const encode=(context.request.headers["accept-encoding"]||"").split(",").map((str)=>str.trim())
	console.log(`---- [${context.reqId}] supported encoding: ${encode}`)
	for(const encoder of encoders){
		if(encode.includes(encoder.name)){
			context.respond.writeHead(code,{"Content-Encoding":encoder.name})
			console.log(`---- [${context.reqId}] use encoding: ${encoder.name}`)
			stream.pipe(encoder.builder()).pipe(context.respond)
			return
		}
	}
	context.respond.writeHead(code)
	stream.pipe(context.respond)
}

const serveConfirmedFile=async(context,filepath,code,checkTime)=>{
	if(checkTime&&(context.stat!==undefined)){
		let mime=mimetype[path.extname(filepath)]
		if(mime){
			context.respond.setHeader("Content-Type",mimetype[path.extname(filepath)])
		}
		let stat=context.stat
		let mtime=stat.mtime.getTime()<serverStartTime.getTime()?serverStartTime:stat.mtime
		context.respond.setHeader("Last-Modified",mtime.toUTCString())
		let ifModifiedAfter=Date.parse(context.request.headers["if-modified-since"])
		if(!isNaN(ifModifiedAfter)){
			if(path.extname(filepath)!==".html"){
				console.log(`---- [${context.reqId}] detected header if-modified-since: ${new Date(ifModifiedAfter).toUTCString()}(${ifModifiedAfter})`)
				if(mtime.getTime()-ifModifiedAfter<=999){
					console.log(`---- [${context.reqId}] file is not modified, send 304`)
					context.respond.writeHead(304)
					context.respond.end()
					return
				}
			}
		}
	}
	await serveStream(context,fs.createReadStream(filepath),code)
}

const serveFile=async(context,filepath,code=200,checkTime=true,throwInsteadOf404=false)=>{
	console.log(`---- [${context.reqId}] ask for ${filepath}`)
	try{
		await util.promisify(fs.access)(filepath,fs.constants.R_OK)
	}catch(err){
		console.log(`---- [${context.reqId}] not find`)
		if(throwInsteadOf404){
			throw new Error("file not found")
		}else{
			serveError(context,404)
			return
		}
	}
	const stat=await util.promisify(fs.stat)(filepath)
	if(stat.isDirectory()){
		console.log(`---- [${context.reqId}] requested file is a directory`)
		if((context.processedPath[context.processedPath-1]!=="/")&&(context.url.pathname[context.url.pathname.length-1]!=="/")){
			console.log(`---- [${context.reqId}] requested path do not end with "/", 301 redirect`)
			context.respond.writeHead(301,{Location:`${context.url.pathname}/`})
			context.respond.end()
		}else{
			console.log(`---- [${context.reqId}] try /index.html`)
			const indexpath=path.join(filepath,"/index.html")
			try{
				await util.promisify(fs.access)(indexpath,fs.constants.R_OK)
				const stat=(await util.promisify(fs.stat)(indexpath))
				if(stat.isDirectory()){
					throw new Error("index is directory")
				}
				context.stat=stat
			}catch(err){
				console.log(`---- [${context.reqId}] index not find`)
				if(throwInsteadOf404){
					throw new Error("file not found")
				}else{
					serveError(context,404)
					return
				}
			}
			await serveConfirmedFile(context,indexpath,code,checkTime)
		}
	}else{
		context.stat=stat
		await serveConfirmedFile(context,filepath,code,checkTime)
	}
}

const serveError=async(context,errorCode)=>{
	let customErrorPage=context.errorPage
	if(customErrorPage!==undefined){
		if(errorCode in customErrorPage){
			let filepath=path.resolve(context.baseErrorPath,customErrorPage[errorCode])
			try{
				await serveFile(context,filepath,errorCode,false,true)
				return
			}catch(err){
				console.log(`---- [${context.reqId}] error page for ${errorCode} (${filepath}) not found`)
			}
		}
	}
	let customErrorMessage=context.errorMessage
	if(customErrorMessage!==undefined){
		if(errorCode in customErrorMessage){
			context.respond.writeHead(errorCode)
			context.respond.end(customErrorMessage[errorCode])
			return
		}
	}
	if(errorCode in errorPage){
		let filepath=path.resolve(context.baseErrorPath,errorPage[errorCode])
		try{
			await serveFile(context,filepath,errorCode,false,true)
			return
		}catch(err){
			console.log(`---- [${context.reqId}] error page for ${errorCode} (${filepath}) not found`)
		}
	}
	context.respond.writeHead(errorCode)
	context.respond.end((errorCode in errorMessage)?(errorMessage[errorCode]):(defaultErrorMessage[errorCode]||"pikaServiceError: unknown error\n"))
}

const defaultAction=async(context)=>{
	await serveFile(context,path.join(context.basePath,context.processedPath))
	return true
}

const rangeBlockBuilder=(schema)=>async(context)=>{
	if(path.relative(schema.path,context.processedPath)[0]!=="."){
		console.log(`---- [${context.reqId}] blocked: child of "${schema.path}"`)
		await serveError(context,404)
		return true
	}
	return false
}

const pathRewriteBuilder=(schema)=>async(context)=>{
	if(context.processedPath===schema.from){
		console.log(`---- [${context.reqId}] rewrited: from "${schema.from}" to "${schema.to}"`)
		context.processedPath=schema.to
	}
	return false
}

const rangePathRewriteBuilder=(schema)=>async(context)=>{
	if(path.relative(schema.from,context.processedPath)[0]!=="."){
		console.log(`---- [${context.reqId}] rewrited: from child of "${schema.from}" to "${schema.to}"`)
		context.processedPath=schema.to
	}
	return false
}

const serveFileBuilder=(schema)=>async(context)=>{
	if(context.processedPath===schema.path){
		console.log(`---- [${context.reqId}] hit: path "${schema.path}", send file "${schema.file}"`)
		await serveFile(context,path.resolve(context.basePath,schema.file))
		return true
	}
	return false
}

const rangeServeFileBuilder=(schema)=>async(context)=>{
	let relative=path.relative(schema.path,context.processedPath)
	if(relative[0]!=="."){
		console.log(`---- [${context.reqId}] hit: path "${schema.path}", reset base to "${schema.base}"`)
		await serveFile(context,path.resolve(context.basePath,schema.base,relative))
		return true
	}
	return false
}

let actionBuilders={
	rangeBlock:rangeBlockBuilder,
	pathRewrite:pathRewriteBuilder,
	rangePathRewrite:rangePathRewriteBuilder,
	serveFile:serveFileBuilder,
	rangeServeFile:rangeServeFileBuilder
}

const actionBuilder=(schema)=>{
	if(schema.type in actionBuilders){
		return actionBuilders[schema.type](schema)
	}
	console.log(`Warning: schema "${schema}" is not recognized`)
	return async(context)=>false
}

const builderUtil={
	actionBuilder:actionBuilder,
	serveError:serveError,
	serveFile:serveFile,
	serveConfirmedFile:serveConfirmedFile,
	serveStream:serveStream
}

const registerPlugin=(identifier)=>{
	try{
		const{builder,type}=require(identifier)(config,builderUtil)
		actionBuilders[type]=builder
	}catch(err){
		console.log(`Warning: ${err.message}`)
		console.log(`Warning: plugin "${identifier}" is not registered`)
	}
}

plugins.forEach(registerPlugin)

const actions=actionsSchema.map(actionBuilder)

let reqNum=0
const handler=async(req,res)=>{
	const reqId=Date.now()+reqNum
	reqNum++
	console.log(`-- [${reqId}] request heared at ${new Date()}`)
	const domain=req.headers.host
	const reqUrl=url.parse(req.url,true)
	console.log(`---- [${reqId}] ask for "${reqUrl.pathname}" under "${domain}" with search "<${reqUrl.search}>"`)
	const context={request:req,respond:res,domain:domain,url:reqUrl,processedPath:decodeURIComponent(reqUrl.pathname),reqId:reqId,basePath:basePath,baseErrorPath:basePath}
	if(context.processedPath.match(/(^|\/)\.\.($|\/)/)!==null){
		console.log(`---- [${reqId}] bad request: include ".."`)
		await serveError(context,400)
		return
	}
	try{
		for(const action of actions){
			if(await action(context)){
				return
			}
		}
		console.log(`---- [${reqId}] fallback to default action, try serve static file`)
		await defaultAction(context)
	}catch(err){
		let code=err.code
		if(!(Number.isInteger(code)&&code<600&&code>=100)){
			code=500
		}
		console.log(`---- [${reqId}] error when handling request, code=${code}, err:${err}：\n${err.stack}`)
		await serveError(context,code)
	}
}

let httpServer=null
let httpsServer=null

const setupHttpServer=()=>new Promise((res,rej)=>{
	httpServer=http.createServer((req,res)=>{
		if(httpsOpen&&hsts&&httpsServer){
			res.setHeader("Strict-Transport-Security","max-age=7776000")
			res.writeHead(302,{Location:`https://${req.headers.host}${req.url}`})
			res.end()
			return
		}
		handler(req,res)
	})
	httpServer.listen(httpPort,host,(err)=>{
		if(err){
			console.log(`-- pikaService(http/1.1 over TCP) fail to start`)
			httpServer=null
			rej(err)
		}
		console.log(`-- pikaService(http/1.1 over TCP) running at http://${host}:${httpPort}/`)
		res()
	})
})

const setupHttpsServer=()=>new Promise((res,rej)=>{
	httpsServer=http2.createSecureServer({allowHTTP1:true,key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
		if(hsts){
			res.setHeader("Strict-Transport-Security","max-age=7776000")
		}
		handler(req,res)
	})
	httpsServer.listen(httpsPort,host,(err)=>{
		if(err){
			console.log(`-- pikaService(http/1.1&http/2 over TLS) fail to start`)
			httpsServer=null
			rej(err)
		}
		console.log(`-- pikaService(http/1.1&http/2 over TLS) running at http://[${host}]:${httpsPort}/`)
		res()
	})
})

const updateHttpsServer=()=>new Promise((res,rej)=>{
	console.log(`-- trying to update the cert`)
	child.exec(renewCommand,(err)=>{
		if(err){
			rej(err)
		}else{
			if(httpsServer===null){
				setupHttpsServer().then(res)
			}else{
				httpsServer.close(()=>{
					console.log(`-- restart pikaService(http/1.1&http/2 over TLS)`)
					httpsServer=null
					setupHttpsServer().then(res)
				})
			}
		}
	})
})

const scheduleRenewJob=()=>{
	console.log(`-- next cert update scheduled`)
	setTimeout(()=>{
		updateHttpsServer().then(scheduleRenewJob)
	},renewPeriod)
}

process.on("unhandledRejection",(err,promise)=>{
	console.log(`Unhandled Rejection at: ${promise}\nreason: ${err}`)
	process.exitCode=-1
})

setupHttpServer()
if(httpsOpen){
	if(renewOpen){
		updateHttpsServer().then(scheduleRenewJob)
	}else{
		setupHttpsServer()
	}
}