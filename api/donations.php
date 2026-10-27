<?php
// api/donations.php
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
requireRole(['bank', 'phlebotomist', 'admin']);
const DONATION_STATUSES = ['collected', 'tested', 'processed', 'discarded', 'transfused'];

try {
    if ($method === 'GET') {
        $sql = "SELECT d.*, dn.full_name, dn.qr_code, bt.code as blood_type_code, bc.name as component_name, bb.name as bank_name 
                FROM donation d
                LEFT JOIN donor dn ON d.donor_id = dn.donor_id
                LEFT JOIN blood_type bt ON d.blood_type_id = bt.blood_type_id
                LEFT JOIN blood_component bc ON d.component_id = bc.component_id
                LEFT JOIN blood_bank bb ON d.bank_id = bb.bank_id
                ORDER BY d.collected_at DESC";
        
        $stmt = $conn->prepare($sql);
        if (!$stmt) throw new Exception("SQL Error: " . $conn->error);

        $stmt->execute();
        $donations = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        sendJson(true, 'Donations loaded.', ['count' => count($donations), 'donations' => $donations]);

    } elseif ($method === 'POST') {
        requireFields($input, ['donor_id', 'bank_id', 'blood_type_id', 'component_id', 'units']);
        
        $clientUuid = !empty($input['client_uuid']) ? sanitizeString($input['client_uuid']) : uniqid('SYNC-');
        $collectedAt = !empty($input['collected_at']) ? sanitizeString($input['collected_at']) : date('Y-m-d H:i:s');
        $status = validateEnum((string)($input['status'] ?? 'collected'), DONATION_STATUSES, 'status');

        $stmt = $conn->prepare(
            "INSERT INTO donation (client_uuid, donor_id, bank_id, drive_id, blood_type_id, component_id, phlebotomist_id, units, collected_at, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE donation_id = LAST_INSERT_ID(donation_id)"
        );

        $driveId = !empty($input['drive_id']) ? (int)$input['drive_id'] : null;
        $phlebId = !empty($input['phlebotomist_id']) ? (int)$input['phlebotomist_id'] : null;

        $stmt->bind_param('siiiiidsss', 
            $clientUuid, $input['donor_id'], $input['bank_id'], $driveId, 
            $input['blood_type_id'], $input['component_id'], $phlebId, 
            $input['units'], $collectedAt, $status
        );

        if ($stmt->execute()) {
            $insertId = $stmt->insert_id;
            $dateOnly = substr($collectedAt, 0, 10);
            $donorId = (int)$input['donor_id'];
            $upd = $conn->prepare("UPDATE donor SET last_donation_date = ? WHERE donor_id = ?");
            $upd->bind_param('si', $dateOnly, $donorId);
            $upd->execute();
            $upd->close();

            sendJson(true, 'Donation recorded.', ['donation_id' => $insertId, 'client_uuid' => $clientUuid, 'synced' => true], 201);
        }
        sendJson(false, 'Failed to save donation: ' . $stmt->error, null, 400);

    } elseif ($method === 'PUT') {
        // Consolidated the duplicated PUT blocks
        requireFields($input, ['donation_id']);
        $donationId = (int)$input['donation_id'];
        
        $units = isset($input['units']) ? (float)$input['units'] : 1.0;
        $status = validateEnum(sanitizeString($input['status'] ?? 'collected'), DONATION_STATUSES, 'status');

        $stmt = $conn->prepare("UPDATE donation SET units = ?, status = ? WHERE donation_id = ?");
        $stmt->bind_param('dsi', $units, $status, $donationId);
        if ($stmt->execute()) {
            sendJson(true, 'Donation updated.', ['donation_id' => $donationId]);
        }
        sendJson(false, 'Update failed: ' . $stmt->error, null, 400);

    } elseif ($method === 'DELETE') {
        requireFields($input, ['donation_id']);
        $donationId = (int)$input['donation_id'];

        $conn->query("UPDATE blood_history SET donation_id = NULL WHERE donation_id = {$donationId}");
        $stmt = $conn->prepare("DELETE FROM donation WHERE donation_id = ?");
        $stmt->bind_param('i', $donationId);
        if ($stmt->execute()) {
            sendJson(true, 'Donation deleted.', ['donation_id' => $donationId]);
        }
        sendJson(false, 'Delete failed: ' . $stmt->error, null, 400);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}