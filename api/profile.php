<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $conn = getDbConnection();
    
    // Grab the organizer ID from the URL parameters
    $organizerId = isset($_GET['organizer_id']) ? (int)$_GET['organizer_id'] : 1;

    // Fetch organizer details (Removed the blood_bank JOIN since o.bank_id doesn't exist)
    $sql = "SELECT 
                o.org_name, 
                o.org_code, 
                o.contact_person, 
                o.contact_no, 
                a.email
            FROM organizer o
            LEFT JOIN account a ON o.account_id = a.account_id
            WHERE o.organizer_id = ?";
            
    $stmt = $conn->prepare($sql);
    
    if (!$stmt) {
        throw new Exception("SQL Error: " . $conn->error);
    }
    
    $stmt->bind_param('i', $organizerId);
    $stmt->execute();
    $data = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($data) {
        echo json_encode([
            'success' => true,
            'data' => $data
        ]);
    } else {
        echo json_encode([
            'success' => false,
            'message' => 'Organizer profile not found.'
        ]);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage()
    ]);
}