<?php
// this is session.php - tells a page who is signed in (used by js/guard.js)
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

header('Cache-Control: private, no-store, max-age=0');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendJson(false, 'Method not allowed.', null, 405);
}

startSession();
if (empty($_SESSION['account_id']) || empty($_SESSION['role'])) {
    sendJson(false, 'Please sign in.', null, 401);
}

requireActiveAccount((int)$_SESSION['account_id']);
$role = (string)$_SESSION['role'];
sendJson(true, 'Signed-in session.', ['role' => $role, 'home' => ROLE_HOME[$role] ?? 'index.html']);
