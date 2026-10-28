<?php
// Authorize access to bank HTML pages without changing their browser URLs.
declare(strict_types=1);

if (session_status() !== PHP_SESSION_ACTIVE) session_start();

$page = (string)($_GET['page'] ?? '');
$pages = [
    'dashboard' => 'dashboard.html',
    'donation-log' => 'donation-log.html',
    'requests' => 'requests.html',
    'active_requests' => 'active_requests.html',
    'scan' => 'scan.html',
];
if (!isset($pages[$page])) {
    http_response_code(404);
    exit('Page not found.');
}

$role = (string)($_SESSION['role'] ?? '');
if (empty($_SESSION['account_id']) || !in_array($role, ['bank', 'admin', 'phlebotomist'], true)) {
    header('Location: /kadugo/index.html', true, 302);
    exit;
}
if ($role === 'phlebotomist' && $page !== 'scan') {
    header('Location: /kadugo/pages/bank/scan.html', true, 302);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-store, max-age=0');
header('Vary: Cookie');
header('X-Content-Type-Options: nosniff');
readfile(__DIR__ . '/../pages/bank/' . $pages[$page]);
