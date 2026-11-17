<?php
// this is login.php - handles user authentication and session management
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

startSession();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJson(false, 'Method not allowed.', null, 405);
}

// Arrays (email[]=x) are treated as empty instead of crashing trim().
$email = is_string($_POST['email'] ?? null) ? strtolower(trim($_POST['email'])) : '';
$pass  = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';

if ($email === '' || $pass === '') {
    sendJson(false, 'Enter your email and password.', null, 422);
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 100 || strlen($pass) > 255) {
    sendJson(false, 'Enter a valid email address.', null, 422);
}

// shortcut: failed-attempt counter in a temp file per email+IP; move to a DB table if the app runs on more than one server
$throttleFile = sys_get_temp_dir() . '/kadugo_login_' . sha1($email . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
$attempts = is_file($throttleFile) ? (json_decode((string)file_get_contents($throttleFile), true) ?: []) : [];
$attempts = array_filter($attempts, fn($t) => $t > time() - 900);
if (count($attempts) >= 5) {
    sendJson(false, 'Too many failed attempts. Try again in 15 minutes.', null, 429);
}

$conn = getDbConnection();
$stmt = $conn->prepare('SELECT account_id, password_hash, role, is_active FROM account WHERE email = ? LIMIT 1');
$stmt->bind_param('s', $email);
$stmt->execute();
$acct = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$acct || !password_verify($pass, $acct['password_hash'])) {
    $attempts[] = time();
    file_put_contents($throttleFile, json_encode(array_values($attempts)), LOCK_EX);
    sendJson(false, 'Incorrect email or password.', null, 401);
}

if ((int) $acct['is_active'] !== 1) {
    sendJson(false, 'This account is inactive. Contact your administrator.', null, 403);
}

if (is_file($throttleFile)) unlink($throttleFile);
session_regenerate_id(true);
$_SESSION['account_id'] = (int) $acct['account_id'];
$_SESSION['email'] = $email;
$_SESSION['role'] = $acct['role'];

$upd = $conn->prepare('UPDATE account SET last_login = NOW() WHERE account_id = ?');
$upd->bind_param('i', $_SESSION['account_id']);
$upd->execute();
$upd->close();

sendJson(true, 'Signed in.', [
    'account_id' => (int) $acct['account_id'],
    'role' => $acct['role'],
    'redirect' => ROLE_HOME[$acct['role']] ?? 'index.html',
]);
