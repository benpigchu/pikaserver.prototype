# pikaserver.prototype

The prototype of the pikaserver. It will run on the benpigchu.com in future.

## WHY NODE?

Javascript is the second best language in the world! (wwwww

## WHY PROTOTYPE?

Because this is JUST A framework.

More detials will added here after the app-plugin system finished.

## About config.json
```json
//!!notice: my json praser do not support comment yet, after the support added, this part will be moved to that file
{
	"serviceAddress":"0.0.0.0",//address of http service (default 0.0.0.0)
	"httpServicePort":"80",//port of http service (default 80)
	"staticPath":"/home/benpigchu/static/",//directory to store static files (default /home/user/static/)
	"httpApps":[],//todo: http apps plugin
	"noneHttpApps":[]//todo: none-http apps plugins
}
```