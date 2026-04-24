# Rules for Node.JS based development 

* make the front-end look beautiful. Keep the code simple and maintainable, but give it your whole.
* always write code in TypeScript. Do NOT use plain JavaScript
* always create front-end application in Next.JS
* use `npx --yes create-next-app@latest` to bootstrap a new app and add a second `--yes` flag at the end to automatically use the defaults
* use Tailwind CSS version 3 as version 4 has a configuration structure that doesn't integrate well in Next.JS
* use npm as package manager
* minimize the number of dependencies
* never use dependencies that are depreciated
* use Jest to create unit tests
* redirect output of build steps to a logfile that can be examined later
* always capture the output of commands that create zipfiles to a logout as well (they tend to clutter the chat)
* ensure the system provided nodejs server is stopped (use `sudo systemctl stop npm-dev-server`)  
* ensure the nodejs server with the project is served on 0.0.0.0 port 3000. If port 3000 is in use, stop the system provided nodejs server.
* start the nodejs server in a tmux session
