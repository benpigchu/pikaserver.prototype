const fs=require("fs")
const url=require("url")
const path=require("path")
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

const actionBuilders={}

const actionBuilder=(schema)=>{
	if(schema.type in actionBuilders){
		return actionBuilder(schema)
	}else{
		return(context)=>false
	}
}

const actions=actionsSchema.map(actionBuilder)

const defaultAction=(context)=>{
	context.respond.writeHead(200)
	context.respond.end("hello")
}

let reqNum=0
const handler=(req,res)=>{
	const reqId=Date.now()+reqNum
	reqNum++
	console.log(`-- [${reqId}] request heared at ${new Date()}`)
	const domain=req.headers.host
	const reqUrl=url.parse(req.url,true)
	console.log(`---- [${reqId}] ask for "${reqUrl.pathname}" under "${domain}" with search "${reqUrl.search}>"`)
	const context={request:req,respond:res,domain:domain,url:reqUrl,processedPath:reqUrl.pathname,reqId:reqId}
	for(const action of actions){
		if(action(context)){
			return
		}
	}
	console.log(`---- [${reqId}] no matched action, try serve static file`)
	defaultAction(context)
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