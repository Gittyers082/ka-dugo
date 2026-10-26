<?php
// this is helpers.php - contains utility functions for JSON responses, request data handling, and method overrides
declare(strict_types=1);

require_once __DIR__ . '/config.php';

function sendJson(bool $success, string $message, mixed $data = null, int $statusCode = 200): void {
    http_response_code($statusCode);
    echo json_encode([
        'success' => $success,
        'message' => $message,
        'data' => $data,
        'timestamp' => date('Y-m-d H:i:s')
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

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
