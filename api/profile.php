<?php
header('Content-Type: application/json');
require_once '../config.php'; // Your database connection file

// For now, hardcode the organizer_id to test (e.g., ID 1 is PRC Cavite). 
// Later, replace this with $_SESSION['organizer_id'] from your login system.
$organizer_id = 1; 

try {
    // 1. Fetch Organizer Details with their Account Email
    $stmt = $pdo->prepare("
        SELECT o.org_code, o.org_name, o.contact_person, o.contact_no, a.email 
        FROM organizer o
        JOIN account a ON o.account_id = a.account_id
        WHERE o.organizer_id = ?
    ");
    $stmt->execute([$organizer_id]);
    $profile = $stmt->fetch(PDO::FETCH_ASSOC);

    // 2. Count Total Drives Hosted by this Organizer
    $driveStmt = $pdo->prepare("SELECT COUNT(*) as total_drives FROM drive WHERE organizer_id = ?");
    $driveStmt->execute([$organizer_id]);
    $drives = $driveStmt->fetch(PDO::FETCH_ASSOC);

    if ($profile) {
        echo json_encode([
            "success" => true,
            "data" => [
                "org_name" => $profile['org_name'],
                "org_code" => $profile['org_code'],
                "contact_person" => $profile['contact_person'],
                "email" => $profile['email'],
                "contact_no" => $profile['contact_no'],
                "total_drives" => $drives['total_drives']
            ]
        ]);
    } else {
        echo json_encode(["success" => false, "error" => "Organizer not found."]);
    }
} catch (PDOException $e) {
    echo json_encode(["success" => false, "error" => "Database error."]);
}
?>