# pikaserver.prototype

The prototype of the pikaserver. It will run on the benpigchu.com in future.

## WHY NODE?

Javascript is the second best language in the world! (wwwww

## WHY PROTOTYPE?

Because this is JUST A framework.

More detials will added here after the app-plugin system finished.

## How to use http apps plugin

Just write something export a function(req,res,reqId), where req and res is http.IncomingMessage and http.ServerRespond respectly, and reqId is Id of request for logging.
Then all you need to do is add it to the httpApps list in config.json and determine what pathPrefix will it listen.

## How to use none-http apps plugin

Just write something you want to run when the server start, it even can be not-node.

## About config.json
```json
//!!notice: my json praser do not support comment, this wont fix
{
	"serviceAddress":"0.0.0.0",//address of http service (default 0.0.0.0)
	"httpServicePort":"80",//port of http service (default 80)
	"staticPath":"/home/benpigchu/static/",//directory to store static files (default /home/user/static/)
	"errorMessage":{
		"400":"WTF"
	},//custome error message
	"errorPage":{
		"404":"/home/benpigchu/static/404.html"
	},//custome error page, the will overwrite the setting above
	"staticRedirection":[
		{"from":"/from","to":"/to"},
		{"from":"/begin/index.html","to":"/end.html"}//this will not make /begin/ redirected to /end.html
	],//folder or file redirection for static file service
	"staticRangeRedirection":[
		{"from":"/origin","to":"/origin/index.html"}
	],//map a folder to a returning file
	"staticRangeRejection":[
		"/nothing"
	],//any file under the path will mark as 404
	"staticLinking":[
		{"from":"/here","to":"/home/benpigchu/to"}
	],//similiar to the staticRedirection, but the to file is local path
	"httpApps":[
		{
			"name":"example",//name of the plugin, will be shown in log
			"file":"httpApps/example.js",//path to the js file of plugin
			"pathPrefix":"/example/"//only the request with urlpath beginning with this will be responded by the plugin, must begin and end with "/"
		}
	],
	"noneHttpApps":[
		{
			"name":"anotherExample",//name of the plugin, will be shown in log
			"command":"node",//command to run it
			"arg":["noneHttpApps/example.js"]//args of command
		}
	],
	"domainSetting":{//use different setting on different domain
		"127.0.0.0":{//domain name
			"staticPath":"/home/benpigchu/local"//usable setting include staticPath staticRedirection staticRangeRejection staticRangeRedirection staticLinking httpApps errorMessage errorPage
		}
	},
	"https":{
		"hsts":true,//HSTS setting
		"port":"443",//https port
		"key":"/etc/letsencrypt/live/site.com/privkey.pem",//https key
		"cert":"/etc/letsencrypt/live/site.com/fullchain.pem",//https cert
		"update":{
			"period":1728000000,//update period( in ms)
			"command":"/home/letsencrypt/letsencrypt-auto renew"//update command
		}
	}
}
```