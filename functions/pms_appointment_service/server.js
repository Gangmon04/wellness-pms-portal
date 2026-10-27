'use strict';

const http = require('http');
const handler = require('./index');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
	handler(req, res);
});

server.listen(PORT);
