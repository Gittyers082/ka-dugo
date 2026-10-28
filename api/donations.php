<?php
// api/donations.php
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
requireRole(['bank', 'phlebotomist', 'admin']);
// Scanner staff can only create a collected donation, not browse/edit/delete the log.
if (($_SESSION['role'] ?? '') === 'phlebotomist' && $method !== 'POST') {
    sendJson(false, 'Phlebotomists can only record donations from the scanner.', null, 403);
}
const DONATION_STATUSES = ['collected', 'tested', 'processed', 'discarded', 'transfused'];

// Bank staff only see and write their own bank's donations; the session decides, not the browser.
$sessionBankId = signedInBankId();
if ($sessionBankId !== null && ($method === 'PUT' || $method === 'DELETE')) {
    $ownDonationId = (int)($input['donation_id'] ?? 0);
    $own = $conn->prepare('SELECT 1 FROM donation WHERE donation_id = ? AND bank_id = ?');
    $own->bind_param('ii', $ownDonationId, $sessionBankId);
    $own->execute();
    if (!$own->get_result()->fetch_assoc()) sendJson(false, 'Donation not found for this bank.', null, 404);
}

try {
    if ($method === 'GET') {
        $sql = "SELECT d.*, dn.full_name, dn.qr_code, bt.code as blood_type_code, bc.name as component_name, bb.name as bank_name
                FROM donation d
                LEFT JOIN donor dn ON d.donor_id = dn.donor_id
                LEFT JOIN blood_type bt ON d.blood_type_id = bt.blood_type_id
                LEFT JOIN blood_component bc ON d.component_id = bc.component_id
                LEFT JOIN blood_bank bb ON d.bank_id = bb.bank_id
                " . ($sessionBankId !== null ? "WHERE d.bank_id = ?" : "") . "
                ORDER BY d.collected_at DESC";

        $stmt = $conn->prepare($sql);
        if (!$stmt) throw new Exception("SQL Error: " . $conn->error);
        if ($sessionBankId !== null) $stmt->bind_param('i', $sessionBankId);

        $stmt->execute();
        $donations = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        sendJson(true, 'Donations loaded.', ['count' => count($donations), 'donations' => $donations]);

    } elseif ($method === 'POST') {
        if ($sessionBankId !== null) $input['bank_id'] = $sessionBankId;
        if ($_SESSION['role'] === 'phlebotomist') {
            $accountId = (int)$_SESSION['account_id'];
            $ph = $conn->prepare('SELECT phlebotomist_id FROM phlebotomist WHERE account_id = ? LIMIT 1');
            $ph->bind_param('i', $accountId);
            $ph->execute();
            $input['phlebotomist_id'] = (int)($ph->get_result()->fetch_assoc()['phlebotomist_id'] ?? 0);
            $ph->close();
            if ($input['phlebotomist_id'] < 1) {
                sendJson(false, 'Phlebotomist profile not found.', null, 403);
            }
            // Ignore caller-supplied status and blood type for scanner records.
            $input['status'] = 'collected';
            $donorId = (int)($input['donor_id'] ?? 0);
            $typeStmt = $conn->prepare('SELECT blood_type_id FROM donor WHERE donor_id = ? LIMIT 1');
            $typeStmt->bind_param('i', $donorId);
            $typeStmt->execute();
            $donorType = $typeStmt->get_result()->fetch_assoc();
            $typeStmt->close();
            if (!$donorType) sendJson(false, 'Donor not found.', null, 404);
            $input['blood_type_id'] = (int)$donorType['blood_type_id'];
        }
        requireFields($input, ['donor_id', 'bank_id', 'blood_type_id', 'component_id', 'units']);
        $input['donor_id'] = validateIntRange($input['donor_id'], 1, PHP_INT_MAX, 'donor_id');
        $input['bank_id'] = validateIntRange($input['bank_id'], 1, PHP_INT_MAX, 'bank_id');
        $input['blood_type_id'] = validateIntRange($input['blood_type_id'], 1, 8, 'blood_type_id');
        $input['component_id'] = validateIntRange($input['component_id'], 1, 4, 'component_id');
        $input['units'] = validateFloatRange($input['units'], 0.25, 10, 'units');
        if (!empty($input['drive_id'])) validateIntRange($input['drive_id'], 1, PHP_INT_MAX, 'drive_id');

        $clientUuid = !empty($input['client_uuid']) ? sanitizeString($input['client_uuid']) : uniqid('SYNC-');
        if (strlen($clientUuid) > 36) sendJson(false, 'client_uuid must be at most 36 characters.', null, 422);
        $collectedAt = !empty($input['collected_at']) ? validateDateTime((string)$input['collected_at'], 'collected_at') : date('Y-m-d H:i:s');
        $status = validateEnum((string)($input['status'] ?? 'collected'), DONATION_STATUSES, 'status');

        $stmt = $conn->prepare(
            "INSERT INTO donation (client_uuid, donor_id, bank_id, drive_id, blood_type_id, component_id, phlebotomist_id, units, collected_at, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE donation_id = LAST_INSERT_ID(donation_id)"
        );

        $driveId = !empty($input['drive_id']) ? (int)$input['drive_id'] : null;
        $phlebId = !empty($input['phlebotomist_id']) ? (int)$input['phlebotomist_id'] : null;

        $stmt->bind_param('siiiiiidss',
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
        
        // Omitted fields keep their stored value instead of being reset to defaults.
        $units = isset($input['units']) && $input['units'] !== '' ? validateFloatRange($input['units'], 0.25, 10, 'units') : null;
        $status = isset($input['status']) && $input['status'] !== '' ? validateEnum(sanitizeString($input['status']), DONATION_STATUSES, 'status') : null;
        if ($units === null && $status === null) sendJson(false, 'Provide units or status to update.', null, 422);

        $stmt = $conn->prepare("UPDATE donation SET units = COALESCE(?, units), status = COALESCE(?, status) WHERE donation_id = ?");
        $stmt->bind_param('dsi', $units, $status, $donationId);
        if ($stmt->execute()) {
            sendJson(true, 'Donation updated.', ['donation_id' => $donationId]);
        }
        sendJson(false, 'Update failed: ' . $stmt->error, null, 400);

    } elseif ($method === 'DELETE') {
        requireFields($input, ['donation_id']);
        $donationId = (int)$input['donation_id'];

        $unlink = $conn->prepare("UPDATE blood_history SET donation_id = NULL WHERE donation_id = ?");
        $unlink->bind_param('i', $donationId);
        $unlink->execute();
        $stmt = $conn->prepare("DELETE FROM donation WHERE donation_id = ?");
        $stmt->bind_param('i', $donationId);
        if ($stmt->execute()) {
            sendJson(true, 'Donation deleted.', ['donation_id' => $donationId]);
        }
        sendJson(false, 'Delete failed: ' . $stmt->error, null, 400);
    } else {
        sendJson(false, 'Method not allowed.', null, 405);
    }
} catch (Exception $e) {
    error_log((string)$e);
    sendJson(false, 'Could not process the donation request.', null, 500);
}