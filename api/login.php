<?php
// this is login.php - handles user authentication and session management
declare(strict_types=1);
require_once __DIR__ . '/config.php';

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
session_start();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed.']);
    exit;
}

$home = [
    'donor' => 'pages/donor/donor-dashboard.html',
    'bank' => 'pages/bank/dashboard.html',
    'phlebotomist' => 'pages/bank/scan.html',   
    'organizer' => 'pages/organizer/drives.html', 
    'admin' => 'pages/bank/dashboard.html',   
];

$email = strtolower(trim($_POST['email'] ?? ''));
$pass  = $_POST['password'] ?? '';

if ($email === '' || $pass === '') {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => 'Enter your email and password.']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 100 || strlen($pass) > 255) {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => 'Enter a valid email address.']);
    exit;
}

$conn = getDbConnection();
$stmt = $conn->prepare('SELECT account_id, password_hash, role, is_active FROM account WHERE email = ? LIMIT 1');
$stmt->bind_param('s', $email);
$stmt->execute();
$acct = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$acct || !password_verify($pass, $acct['password_hash'])) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Incorrect email or password.']);
    exit;
}

if ((int) $acct['is_active'] !== 1) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'This account is inactive. Contact your administrator.']);
    exit;
}

session_regenerate_id(true);
$_SESSION['account_id'] = (int) $acct['account_id'];
$_SESSION['email'] = $email;
$_SESSION['role'] = $acct['role'];

$upd = $conn->prepare('UPDATE account SET last_login = NOW() WHERE account_id = ?');
$upd->bind_param('i', $_SESSION['account_id']);
$upd->execute();
$upd->close();

http_response_code(200);
echo json_encode([
    'ok'   => true,
    'data' => [
        'account_id' => $acct['account_id'],
        'role' => $acct['role'],
        'redirect' => $home[$acct['role']] ?? 'index.html',
    ],
]);
exit;