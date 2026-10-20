<?php
require_once __DIR__ . '/db.php';

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

// Where each role lands after login (paths are relative to the site root)
$home = [
    'donor'        => 'pages/donor/dashboard.html',
    'bank'         => 'pages/bank/dashboard.html',
    'phlebotomist' => 'pages/bank/dashboard.html',   
    'organizer'    => 'pages/organizer/drives.html', 
    'admin'        => 'pages/bank/dashboard.html',   
];

// Validate input
$email = strtolower(trim($_POST['email'] ?? ''));
$pass  = $_POST['password'] ?? '';

if ($email === '' || $pass === '') {
    json_response(['ok' => false, 'error' => 'Enter your email and password.'], 422);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 100 || strlen($pass) > 255) {
    json_response(['ok' => false, 'error' => 'Enter a valid email address.'], 422);
}

// Look up the account (prepared statement)
$stmt = $db->prepare(
    'SELECT account_id, password_hash, role, is_active
     FROM account WHERE email = ? LIMIT 1'
);
$stmt->bind_param('s', $email);
$stmt->execute();
$acct = $stmt->get_result()->fetch_assoc();
$stmt->close();

// One generic message, so attackers can't tell which emails exist
if (!$acct || !password_verify($pass, $acct['password_hash'])) {
    json_response(['ok' => false, 'error' => 'Incorrect email or password.'], 401);
}

if ((int) $acct['is_active'] !== 1) {
    json_response(['ok' => false, 'error' => 'This account is inactive. Contact your administrator.'], 403);
}

// Success: start a fresh session
session_regenerate_id(true);
$_SESSION['account_id'] = (int) $acct['account_id'];
$_SESSION['email']      = $email;
$_SESSION['role']       = $acct['role'];

$upd = $db->prepare('UPDATE account SET last_login = NOW() WHERE account_id = ?');
$upd->bind_param('i', $_SESSION['account_id']);
$upd->execute();
$upd->close();

json_response([
    'ok'   => true,
    'data' => [
        'role'     => $acct['role'],
        'redirect' => $home[$acct['role']] ?? 'index.html',
    ],
]);