<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

date_default_timezone_set('Asia/Manila');

// The PWA and the API share one origin, so no CORS headers are needed.
header('Content-Type: application/json; charset=utf-8');

define('DB_HOST', '127.0.0.1');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', getenv('KADUGO_DB_NAME') ?: 'kadugo_db'); // env override lets a test copy run beside the real DB
define('DB_PORT', 3306);

function getDbConnection(): mysqli {
    static $conn = null;

    if ($conn === null) {
        // Every failed query throws; helpers.php turns uncaught errors into a JSON 500.
        mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
        try {
            $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
        } catch (mysqli_sql_exception $e) {
            // Log the real reason; never send DB details to the browser.
            error_log('DB connection failed: ' . $e->getMessage());
            http_response_code(503);
            echo json_encode(['ok' => false, 'data' => null, 'error' => 'The database is unavailable. Please try again shortly.']);
            exit;
        }
        $conn->set_charset('utf8mb4');
    }

    return $conn;
}
