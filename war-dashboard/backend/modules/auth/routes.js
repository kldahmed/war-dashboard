'use strict';

const express = require('express');
const { signup, signin, refresh, logout, meWithAuth } = require('./handlers');

const router = express.Router();

router.post('/auth/signup', signup);
router.post('/auth/signin', signin);
router.post('/auth/refresh', refresh);
router.post('/auth/logout', logout);
router.get('/auth/me', meWithAuth);

module.exports = router;
