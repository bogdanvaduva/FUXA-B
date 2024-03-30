![fuxa logo](/client/src/favicon.ico) 
# FUXA-B
FUXA-B is a web-based Process Visualization (SCADA/HMI/Dashboard) software forked from FUXA found at https://github.com/frangoteam/FUXA/. With FUXA-B you can create modern process visualizations with individual designs for your machines and real-time data display. FUXA-B has a few other features than the original FUXA. It has  been added a new DAQ type which is PostgreSQL (we plan to add MySQL/MariaDB as well), a new data source called Repeater Data, a new component called Repeater. Also within the FUXA-B logic we integrated a generic tagName that can be provided to the view through URL query params allowing to build templates.

![fuxa editor](/screenshot/fuxa-editor.png) 

![fuxa ani](/screenshot/fuxa-ani.gif)

![fuxa action](/screenshot/feature-action-move.gif)

## Features - from the original FUXA
- Devices connectivity with Modbus RTU/TCP, Siemens S7 Protocol, OPC-UA, BACnet IP, MQTT, Ethernet/IP (Allen Bradley)
- SCADA/HMI Web-Editor - Engineering and Design completely web-based
- Cross-Platform Full-Stack - Backend with NodeJs and Frontend with Web technologies (HTML5, CSS, Javascript, Angular, SVG)

## Live Demo (of the original FUXA)
Here is a [live demo](https://frangoteam.github.io) example of main FUXA project.

## Installing and Running
FUXA is developed with NodeJS (backend) and Angular (frontend).

running from docker it's not yet available for FUXA-B

[Download the latest release](https://github.com/bogdanvaduva/FUXA-B) and unpack it

You need to have installed [Node](https://nodejs.org/en/about/previous-releases) Version 14.21.3 (npm 6.14.18) || 16.20.2 (npm 8.19.4) || 18.18.2 (npm 9.8.1).

**WARNING** In linux with nodejs Version 16.20.2 || 18.18.2 there are problems with the node-snap7 library for communication with Siemens S7 PLCs, if you don't intend to use it you can remove it from the server/package.json

```
cd ./server
npm install
npm start
```

Open up a browser (better Chrome) and navigate to http://localhost:1881

## Usage
Look the guide in [wiki](https://github.com/frangoteam/FUXA/wiki) pages

## To Debug (Full Stack)
Install and start to serve the frontend
```
cd ./client
npm install
npm start
```

Start the Server and Client (Browser) in Debug Mode
```
In vscode: Debug ‘Server & Client’
```

## To Build
Build the frontend for production
```
cd ./client
ng build --prod
```

## Contributing
Any contributions you make are greatly appreciated.
If you identify any errors, or have an idea for an improvement, please open an [issue](/../../issues).
But before filing a new issue, please look through already existing issues. Search open and closed issues first.

### Pull-Requests
If you want to raise a pull-request with a new feature, or a refactoring of existing code please first open an issue explaining the problem.
```
1. Fork the Project
2. Create your Feature Branch (git checkout -b feature/AmazingFeature)
3. Commit your Changes (git commit -m 'Add some AmazingFeature')
4. Push to the Branch (git push origin feature/AmazingFeature)
5. Open a Pull Request
```

### Coding standards
Please ensure you follow the coding standards used through-out the existing code base. Some basic rules include:
- Indent with 4-spaces, no tabs.
- Opening brace on same line as if/for/function and so on, closing brace on its own line.

## License
MIT.
