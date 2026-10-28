<?php
// Lightweight session/role check for bank page navigation.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
header('Cache-Control: private, no-store, max-age=0');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendJson(false, 'Method not allowed.', null, 405);
}
if (session_status() !== PHP_SESSION_ACTIVE) session_start();
if (empty($_SESSION['account_id']) || empty($_SESSION['role'])) {
    sendJson(false, 'Please sign in.', null, 401);
}
sendJson(true, 'Signed-in session.', ['role' => $_SESSION['role']]);
