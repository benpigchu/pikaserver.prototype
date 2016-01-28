# pikaserver.prototype

The prototype of the pikaserver. It will run on the benpigchu.com in future.

## WHY NODE?

Javascript is the second best language in the world! (wwwww

## WHY PROTOTYPE?

Because this is JUST A framework.

More detials will added here after the app-plugin system finished.

## How to use http apps plugin

Just write something export a function(req,res), where req and res is http.IncomingMessage and http.ServerRespond respectly. 
Then all you need to do is add it to the httpApps list in config.json and determine what pathPrefix will it listen.

## About config.json
```json
//!!notice: my json praser do not support comment, this wont fix
{
	"serviceAddress":"0.0.0.0",//address of http service (default 0.0.0.0)
	"httpServicePort":"80",//port of http service (default 80)
	"staticPath":"/home/benpigchu/static/",//directory to store static files (default /home/user/static/)
	"mimeType":{},//pairs of suffix and mime-type
	"httpApps":[
		{
			"name":"example",//name of the plugin, will be shown in log
			"file":"httpApps/example.js",//path to the js file of plugin
			"pathPrefix":"/example/"//only the request with urlpath beginning with this will be responded by the plugin, must begin and end with "/"
		}
	],
	"noneHttpApps":[]//todo: none-http apps plugins
}
```