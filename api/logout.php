<?php
// this is logout.php - ends the server session for any role
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJson(false, 'Method not allowed.', null, 405);
}

if (session_status() !== PHP_SESSION_ACTIVE) session_start();
$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
}
session_destroy();
sendJson(true, 'Signed out.');
