'use strict';

const { app } = require('electron');

app.setName('desktop-demo');
process.env.DESKTOP_DEMO_MODE = 'standalone';
if (process.platform === 'win32') app.setAppUserModelId('com.404404.desktopdemo');

require('./standalone-main.cjs');
