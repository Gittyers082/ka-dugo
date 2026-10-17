<?php
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
