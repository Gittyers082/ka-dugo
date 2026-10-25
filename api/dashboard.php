<?php
// api/organizer/dashboard.php
header('Content-Type: application/json');

// Include your database connection file (adjust the path if your config.php is located elsewhere)
require_once '../config.php'; 

// For testing purposes, we hardcode the organizer ID to 1 (Philippine Red Cross Cavite).
// Once your login system is fully wired up, replace this with: $organizer_id = $_SESSION['organizer_id'];
$organizer_id = 1; 

try {
    // 1. Calculate Active Drives
    // Counts drives belonging to this organizer that are currently 'scheduled' or 'ongoing'
    $stmtDrives = $pdo->prepare("
        SELECT COUNT(*) as active_count 
        FROM drive 
        WHERE organizer_id = ? AND status IN ('scheduled', 'ongoing')
    ");
    $stmtDrives->execute([$organizer_id]);
    $activeDrives = $stmtDrives->fetch(PDO::FETCH_ASSOC);

    // 2. Calculate Total Donors Registered
    // Joins drive_registration with drive to count unique donors registered to this specific organizer's drives
    $stmtDonors = $pdo->prepare("
        SELECT COUNT(DISTINCT dr.donor_id) as donor_count 
        FROM drive_registration dr
        JOIN drive d ON dr.drive_id = d.drive_id
        WHERE d.organizer_id = ?
    ");
    $stmtDonors->execute([$organizer_id]);
    $totalDonors = $stmtDonors->fetch(PDO::FETCH_ASSOC);

    // 3. Output the JSON Response
    // (Pending sync is typically managed locally by your PWA's IndexedDB, so the server returns 0 here)
    echo json_encode([
        "success" => true,
        "data" => [
            "active_drives" => (int) $activeDrives['active_count'],
            "total_donors"  => (int) $totalDonors['donor_count'],
            "pending_sync"  => 0 
        ]
    ]);

} catch (PDOException $e) {
    // Return a clean error if the database query fails
    echo json_encode([
        "success" => false, 
        "error" => "Database error: " . $e->getMessage()
    ]);
}
?>