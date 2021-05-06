//Configuraciones
const { title, central_url, puerto_controladores, puerto_api } = require('../config/config');
process.title = title;

const express = require('express');
const bodyParser = require('body-parser');

var net = require('net');
var Request = require("request");

const app = express();

app.use(bodyParser.urlencoded({extended:false}))
app.use(bodyParser.json())

var sockets = []; 
var socketsID = [];
var socketsMessageRx = [];
var socketsMessageTx = [];
var lastConectados = [];

async function enviarBroadcast(content) {
	await Promise.all(sockets.map(async (socket) => {
		await socket.write("<"+content+">")
		console.log("Mensaje Broadcast a : ",socket.name);
	}))
};

app.get('/', function (request, response) {
    response.send('Funcionando');
});

var server = net.createServer( (socket) => {
	socket.name = socket.remoteAddress + ":" + socket.remotePort
	sockets.push(socket); socketsID.push(socket.name.substr(7)); lastConectados.push(socket.name.substr(7))
	//Obliga a saludar (una prueba)
	socket.write('<[00A]>');
	console.log(socket.name + ' conectado.')
	//console.log('Últimos 20 clientes TCP: '+puerto_controladores+' conectados: ',lastConectados.slice(Math.max(lastConectados.length - 20, 0)))

	socket.on('data', (data) => {
		
		// Mensaje que llega del Cliente TCP.
		textChunk = data.toString('utf8').substr(1,data.toString('utf8').length-2);
		//console.log('Mensaje de ' + socket.name.substr(7) + " : ",textChunk)
		
		// Últimos 20 mensajes que llegaron del Cliente TCP
		if (socketsMessageRx.length >= 20) {
			socketsMessageRx.splice(0,1);
			socketsMessageRx.push([socket.name.substr(7),data.toString('utf8')]);
		} else {
			socketsMessageRx.push([socket.name.substr(7),data.toString('utf8')]);
		}
		//console.log('Últimos 20 Mensajes Recibidos al : ' + port,socketsMessageRx.slice(Math.max(socketsMessageRx.length - 20, 0)))
		
		if (data){
			var serverInfo = "<Mensaje recibido.>"
			var buf = Buffer.from(serverInfo, 'utf8');
			//socket.write(buf);

			// Recibe mensaje del TCP Client y envía al WebMethod. Del 9000 al 80.
			var timeserver = new Date();
			var horaServer = timeserver.getHours()
			var token = Math.pow(horaServer,2).toString(16).padStart(4, '0').toUpperCase()

			let xml =
			`<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
				<soap:Body>
					<RecibirTrama xmlns="http://www.rtsolutionsonline.com">
						<mensajeRecibido>[`+ textChunk +`]</mensajeRecibido>
						<nuevaIP>`+ socket.name.substr(7) +`</nuevaIP>
						<token>`+ token +`</token>
					</RecibirTrama>
				</soap:Body>
			</soap:Envelope>`


			var options = {
				
				url: central_url,
				method: 'POST',
				body: xml,
				headers: {
				  'Content-Type':'text/xml; charset=utf-8',
				  'Content-Length': xml.length,
				  'SOAPAction':"http://www.rtsolutionsonline.com/RecibirTrama"
				}
			};
			  
			Request(options, (error, response, body) => {
				if(error) {
					console.log('Error WebMethod:80 ',error)
				}//else { 
				//	console.log(response.statusCode, response.statusMessage, body)
				//}
			})
		}
	});

	// Invocan el POST y Envía la data que recibe al cliente en el TCP. Del 3000 al 9000.
	app.post('/enviar', function(request, response) {
		let body = request.body;
		//console.log(body)
		
		if (body.ipDestino != undefined){
			response.status(200).json({
				Trama : body.Trama,
				ipDestino : body.ipDestino
			})
			// ipDestino = 0.0.0.0 Es para enviar un mensaje como Broadcast.
			if (body.ipDestino == "0.0.0.0"){
				enviarBroadcast(body.Trama);
			} else if (socketsID.includes(body.ipDestino)){
				for(var i = 0; i < sockets.length; i += 1) {
					if(sockets[i].name === '::ffff:'+body.ipDestino) {
						sockets[i].write("<"+body.Trama+">")
					}
				}
			} else {
				console.log('Error, ip Destino no conectada')
			}
			// Últimos 20 mensajes que se enviaron al Cliente TCP
			if (socketsMessageTx.length >= 20) {
				socketsMessageTx.splice(0,1);
				socketsMessageTx.push([body.ipDestino,"<"+body.Trama+">"]);
			} else {
				socketsMessageTx.push([body.ipDestino,"<"+body.Trama+">"]);
			}
			//console.log('Últimos 20 Mensajes Transmitidos al : ' + port,socketsMessageTx.slice(Math.max(socketsMessageTx.length - 20, 0)));
		} else {
			response.status(400).json({
				Mensaje : "Necesita definir una Ip Destino."
			})
		}
    })
	
	// Desconectar el Cliente TCP que se indique.
	app.post('/desconectar', function(request, response) {
		let body = request.body;
		//console.log(body)
		
		if (body.ipDesconectar != undefined){
			response.status(200).json({
				ipDesconectar : body.ipDesconectar
			})
			if (socketsID.includes('::ffff:'+body.ipDesconectar)){
				for(var i = 0; i < sockets.length; i += 1) {
					if(sockets[i].name === '::ffff:'+body.ipDesconectar) {
						sockets[i].destroy()
						sockets.splice(sockets.indexOf(sockets[i]),1);
					}
				}
			}
		} else {
			response.status(400).json({
				Mensaje : "Necesita definir una Ip Destino."
			})
		}
	})
    
	socket.on('close', () =>{
		console.log(socket.name + " desconectado.");
		if(socketsID.includes(socket.name.substr(7))) {
			socketsID.splice(socketsID.indexOf(socket.name.substr(7)),1);
		}
		sockets.splice(sockets.indexOf(socket),1);
	});

	socket.on('error', (error) =>{
		console.log('Error del Cliente TCP: ' + puerto_controladores, error.code, error.message);
	});
});

server.on('error', (error) => {
	console.log('Error del Server TCP: ' + puerto_controladores, error.message);
});

server.listen(puerto_controladores, ()=>{
	console.log("Server escuchando en el puerto : " + puerto_controladores)
});

app.get('/conectados', function (request, response) {
    response.send(socketsID);
});

app.get('/transmitidos', function (request, response) {
    response.send(socketsMessageTx.slice(Math.max(socketsMessageTx.length - 20, 0)));
});

app.get('/recibidos', function (request, response) {
    response.send(socketsMessageRx.slice(Math.max(socketsMessageRx.length - 20, 0)));
});

app.listen(puerto_api, () => {
    console.log('App escuchando en el ' + puerto_api + '.')
});

// Para visualizar datos en consola cada cierto tiempo.

//setInterval(() => console.log('Clientes TCP: '+puerto_controladores+' conectados: ',socketsID),5000)
//setInterval(() => console.log('Últimos 20 clientes TCP: '+puerto_controladores+' conectados: ',lastConectados.slice(Math.max(lastConectados.length - 20, 0))),1000)
//setInterval(() => console.log('Últimos 20 Mensajes Recibidos al : ' + puerto_controladores,socketsMessageRx.slice(Math.max(socketsMessageRx.length - 20, 0))), 1000)
//setInterval(() => console.log('Últimos 20 Mensajes Transmitidos al : ' + puerto_controladores,socketsMessageTx.slice(Math.max(socketsMessageTx.length - 20, 0))), 1000)

