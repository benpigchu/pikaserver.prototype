module.exports=(config,util)=>({
	builder:(schema)=>async(context)=>{
		if(context.processedPath===schema.path){
			let query=context.url.search
			console.log(`---- [${context.reqId}] hit: path "${schema.path}", send querystring "${query}"`)
			context.respond.writeHead(200)
			context.respond.end(`querystring: ${query}\n`)
			return true
		}
		return false
	},
	type:"query"
})