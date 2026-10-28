<?php
// this is helpers.php - contains utility functions for JSON responses, request data handling, and method overrides
declare(strict_types=1);

require_once __DIR__ . '/config.php';

// Every endpoint answers {ok, data, error}; success messages are not sent because no client shows them.
function sendJson(bool $success, string $message, mixed $data = null, int $statusCode = 200): void {
    http_response_code($statusCode);
    echo json_encode([
        'ok' => $success,
        'data' => $data,
        'error' => $success ? null : $message,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Anything uncaught still answers in the same shape instead of an empty 500 or a PHP error page.
set_exception_handler(function (Throwable $e): void {
    error_log((string)$e);
    sendJson(false, 'Something went wrong on the server. Please try again.', null, 500);
});

function getRequestData(): array {
    $rawInput = file_get_contents('php://input');
    $jsonData = [];

    if (!empty($rawInput)) {
        $decoded = json_decode($rawInput, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            $jsonData = $decoded;
        }
    }

    return array_merge($_GET, $_POST, $jsonData);
}

function getRequestMethod(array $requestData = []): string {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'POST' && !empty($requestData['_method'])) {
        $override = strtoupper(trim((string)$requestData['_method']));
        if (in_array($override, ['PUT', 'DELETE', 'PATCH'], true)) {
            return $override;
        }
    }

    return $method;
}

// Require a signed-in account with one of the given roles; returns its account_id.
function requireRole(array $roles): int {
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    if (empty($_SESSION['account_id']) || !in_array($_SESSION['role'] ?? '', $roles, true)) {
        sendJson(false, 'You are not allowed to do this. Please sign in with the right account.', null, 401);
    }
    return (int)$_SESSION['account_id'];
}

// Bank and phlebotomist accounts belong to one blood bank; returns null for other roles.
function signedInBankId(): ?int {
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    $sql = match ($_SESSION['role'] ?? '') {
        'bank' => 'SELECT bank_id FROM blood_bank WHERE account_id=? LIMIT 1',
        'phlebotomist' => 'SELECT bank_id FROM phlebotomist WHERE account_id=? LIMIT 1',
        default => null,
    };
    if ($sql === null) return null;
    $accountId=(int)($_SESSION['account_id'] ?? 0);
    $stmt=getDbConnection()->prepare($sql);
    $stmt->bind_param('i',$accountId); $stmt->execute(); $row=$stmt->get_result()->fetch_assoc(); $stmt->close();
    if (!$row) sendJson(false, 'No blood bank is linked to this account.', null, 404);
    return (int)$row['bank_id'];
}

// Resolve the organizer record from the signed-in account, not a localStorage account ID.
function signedInOrganizer(bool $required = true): ?int {
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    if (($_SESSION['role'] ?? '') !== 'organizer' || empty($_SESSION['account_id'])) {
        if ($required) sendJson(false, 'Please sign in with an organizer account.', null, 401);
        return null;
    }
    $accountId=(int)$_SESSION['account_id'];
    $stmt=getDbConnection()->prepare('SELECT o.organizer_id FROM organizer o JOIN account a ON a.account_id=o.account_id WHERE o.account_id=? AND a.is_active=1');
    $stmt->bind_param('i',$accountId); $stmt->execute(); $row=$stmt->get_result()->fetch_assoc(); $stmt->close();
    if (!$row) sendJson(false, 'Organizer profile not found for this account.', null, 404);
    return (int)$row['organizer_id'];
}
