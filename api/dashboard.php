<?php
// this is dashboard.php - organizer dashboard stats (active drives, registered donors)
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') sendJson(false, 'Method not allowed.', null, 405);
$organizerId = signedInOrganizer();
$conn = getDbConnection();
header('Cache-Control: no-store');

$stmt = $conn->prepare(
    "SELECT
        (SELECT COUNT(*) FROM drive WHERE organizer_id = ? AND status IN ('scheduled', 'ongoing')) AS active_drives,
        (SELECT COUNT(DISTINCT dr.donor_id) FROM drive_registration dr
         JOIN drive d ON dr.drive_id = d.drive_id WHERE d.organizer_id = ?) AS total_donors"
);
$stmt->bind_param('ii', $organizerId, $organizerId);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

// Pending sync lives in the PWA's IndexedDB, so the server always reports 0.
sendJson(true, 'Dashboard stats loaded.', [
    'active_drives' => (int)$row['active_drives'],
    'total_donors' => (int)$row['total_donors'],
    'pending_sync' => 0
]);
