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
		config=require(process.argv[2]||"./config.json")
	}catch(err){
		console.log(`Warning: ${err.message}`)
		console.log(`Warning: use default config`)
	}
	return config
}
const config=getConfig()
const{host="::",port:httpPort="80",basePath="/home/user/static/",https={},actions:actionsSchema=[]}=config
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

const serveConfirmedFile=async(context,filepath)=>{
	let stat=context.stat
	let mtime=stat.mtime.getTime()<serverStartTime.getTime()?serverStartTime:stats.mtime
	context.respond.setHeader("Last-Modified",mtime.toUTCString())
	let ifModifiedAfter=Date.parse(context.request.headers["if-modified-since"])
	if(!isNaN(ifModifiedAfter)){
		console.log(`---- [${context.reqId}] detected header if-modified-since: ${new Date(ifModifiedAfter).toUTCString()}(${ifModifiedAfter})`)
		if(mtime.getTime()-ifModifiedAfter<=999){
			console.log(`---- [${context.reqId}] file is not modified, send 304`)
			context.respond.writeHead(304)
			context.respond.end()
			return
		}
	}
	context.respond.setHeader("Content-Type",mimetype[path.extname(filepath)])
	await serveStream(context,fs.createReadStream(filepath),200)
}

const serveFile=async(context,filepath)=>{
	console.log(`---- [${context.reqId}] ask for ${filepath}`)
	try{
		await util.promisify(fs.access)(filepath,fs.constants.R_OK)
	}catch(err){
		console.log(`---- [${context.reqId}] not find`)
		context.respond.writeHead(404)
		context.respond.end("not find")
		return
	}
	const stat=await util.promisify(fs.stat)(filepath)
	if(stat.isDirectory()){
		console.log(`---- [${context.reqId}] requested file is a directory`)
		if(context.url.pathname[context.url.pathname.length-1]!=="/"){
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
				context.respond.writeHead(404)
				context.respond.end("not find")
				return
			}
			await serveConfirmedFile(context,indexpath)
		}
	}else{
		context.stat=stat
		await serveConfirmedFile(context,filepath)
	}
}

const defaultAction=async(context)=>{
	await serveFile(context,path.join(basePath,context.processedPath))
	return true
}

const actionBuilders={}

const actionBuilder=(schema)=>{
	if(schema.type in actionBuilders){
		return actionBuilder(schema)
	}
	return(context)=>false

}

const actions=actionsSchema.map(actionBuilder)

let reqNum=0
const handler=async(req,res)=>{
	const reqId=Date.now()+reqNum
	reqNum++
	console.log(`-- [${reqId}] request heared at ${new Date()}`)
	const domain=req.headers.host
	const reqUrl=url.parse(req.url,true)
	console.log(`---- [${reqId}] ask for "${reqUrl.pathname}" under "${domain}" with search "<${reqUrl.search}>"`)
	const context={request:req,respond:res,domain:domain,url:reqUrl,processedPath:reqUrl.pathname,reqId:reqId}
	if(decodeURIComponent(reqUrl.pathname).match(/(^|\/)\.\.($|\/)/)!==null){
		console.log(`---- [${reqId}] bad request: include ".."`)
		context.respond.writeHead(400)
		context.respond.end("bad request")
		return
	}
	for(const action of actions){
		if(await action(context)){
			return
		}
	}
	console.log(`---- [${reqId}] no matched action, try serve static file`)
	await defaultAction(context)
}

let httpServer
let httpsServer

const setupHttpServer=()=>new Promise((res,rej)=>{
	httpServer=http.createServer((req,res)=>{
		if(httpsOpen&&hsts){
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
		console.log(`-- pikaService(http/1.1&http/2 over TLS) running at http://${host}:${httpsPort}/`)
	})
})

const updateHttps=()=>new Promise((res,rej)=>{
	console.log(`-- trying to update the cert`)
	child.exec(renewCommand,(err)=>{
		if(err){
			rej(err)
		}
		httpsServer.close(()=>{
			console.log(`-- restart pikaService(http/1.1&http/2 over TLS)`)
			httpsServer=null
			setupHttpsServer().then(res)
		})
	})
})

const scheduleRenewJob=()=>{
	setTimeout(()=>{
		updateHttps()
		scheduleRenewJob()
	},renewPeriod)
}

process.on("unhandledRejection",(err,promise)=>{
	console.log(`Unhandled Rejection at: ${promise}\nreason: ${err}`)
	process.exitCode=-1
})

setupHttpServer()
if(httpsOpen){
	setupHttpsServer()
	if(renewOpen){
		scheduleRenewJob()
	}
}