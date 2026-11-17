<?php
// this is donations.php - the main transaction: blood donations collected by phlebotomists
//   POST   phlebotomist  record a collection by donor_id or qr_code (also the offline-sync target;
//                        client_uuid makes it idempotent)
//   GET    phlebotomist  own collections for one day
//          bank          own bank's donation log    } search, status, component_id, from, to, sort, dir
//          admin         every bank (+ bank_id)      }
//   PUT    bank          change units / status of its own donation
//   DELETE bank          remove its own donation
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

const DONATION_STATUSES = ['collected', 'tested', 'processed', 'discarded', 'transfused'];
const DONATION_SORTS = [
    'collected_at' => 'd.collected_at',
    'units' => 'd.units',
    'donor' => 'dn.full_name',
    'status' => 'd.status',
    'bank' => 'bb.name',
];

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
header('Cache-Control: no-store');

$allowed = [
    'GET' => ['phlebotomist', 'bank', 'admin'],
    'POST' => ['phlebotomist'],
    'PUT' => ['bank'],
    'DELETE' => ['bank'],
];
if (!isset($allowed[$method])) {
    sendJson(false, 'Method not allowed.', null, 405);
}
requireRole($allowed[$method]);
$role = $_SESSION['role'];
$bankId = signedInBankId(); // null for admin

/* ---------- helpers ---------- */

function signedInPhlebotomistId(mysqli $conn): int {
    $accountId = (int)$_SESSION['account_id'];
    $stmt = $conn->prepare('SELECT phlebotomist_id FROM phlebotomist WHERE account_id = ? LIMIT 1');
    $stmt->bind_param('i', $accountId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) {
        sendJson(false, 'Phlebotomist profile not found for this account.', null, 403);
    }
    return (int)$row['phlebotomist_id'];
}

// The bank may only touch donations it collected.
function requireOwnDonation(mysqli $conn, int $donationId, int $bankId): array {
    $stmt = $conn->prepare('SELECT donation_id, donor_id FROM donation WHERE donation_id = ? AND bank_id = ?');
    $stmt->bind_param('ii', $donationId, $bankId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) {
        sendJson(false, 'Donation not found for this bank.', null, 404);
    }
    return $row;
}

// last_donation_date always mirrors the donor's latest non-discarded donation.
function refreshLastDonationDate(mysqli $conn, int $donorId): void {
    $stmt = $conn->prepare(
        "UPDATE donor SET last_donation_date = (
             SELECT DATE(MAX(collected_at)) FROM donation WHERE donor_id = ? AND status <> 'discarded'
         ) WHERE donor_id = ?"
    );
    $stmt->bind_param('ii', $donorId, $donorId);
    $stmt->execute();
    $stmt->close();
}

/* ---------- GET: list with filter / search / sort ---------- */

if ($method === 'GET') {
    $where = [];
    $types = '';
    $params = [];

    if ($role === 'phlebotomist') {
        $where[] = 'd.phlebotomist_id = ?';
        $types .= 'i';
        $params[] = signedInPhlebotomistId($conn);
        $day = validateDateString((string)($input['date'] ?? date('Y-m-d')), 'date');
        $where[] = 'DATE(d.collected_at) = ?';
        $types .= 's';
        $params[] = $day;
    } elseif ($bankId !== null) {
        $where[] = 'd.bank_id = ?';
        $types .= 'i';
        $params[] = $bankId;
    } elseif (!empty($input['bank_id'])) {
        $where[] = 'd.bank_id = ?';
        $types .= 'i';
        $params[] = validateIntRange($input['bank_id'], 1, PHP_INT_MAX, 'bank_id');
    }

    $search = sanitizeString($input['search'] ?? '');
    if ($search !== '') {
        $where[] = '(dn.full_name LIKE ? OR dn.qr_code LIKE ? OR d.client_uuid LIKE ?)';
        $like = "%{$search}%";
        $types .= 'sss';
        array_push($params, $like, $like, $like);
    }
    if (!empty($input['status'])) {
        $where[] = 'd.status = ?';
        $types .= 's';
        $params[] = validateEnum((string)$input['status'], DONATION_STATUSES, 'status');
    }
    if (!empty($input['component_id'])) {
        $where[] = 'd.component_id = ?';
        $types .= 'i';
        $params[] = validateIntRange($input['component_id'], 1, 255, 'component_id');
    }
    if (!empty($input['blood_type_id'])) {
        $where[] = 'd.blood_type_id = ?';
        $types .= 'i';
        $params[] = validateIntRange($input['blood_type_id'], 1, 8, 'blood_type_id');
    }
    if (!empty($input['from'])) {
        $where[] = 'DATE(d.collected_at) >= ?';
        $types .= 's';
        $params[] = validateDateString((string)$input['from'], 'from');
    }
    if (!empty($input['to'])) {
        $where[] = 'DATE(d.collected_at) <= ?';
        $types .= 's';
        $params[] = validateDateString((string)$input['to'], 'to');
    }

    // Sort column comes from a fixed list, never from the request text itself.
    $sortColumn = DONATION_SORTS[$input['sort'] ?? 'collected_at'] ?? DONATION_SORTS['collected_at'];
    $direction = strtolower((string)($input['dir'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';

    $sql = "SELECT d.donation_id, d.client_uuid, d.donor_id, d.bank_id, d.drive_id, d.request_id,
                   d.blood_type_id, d.component_id, d.phlebotomist_id, d.units, d.collected_at, d.status,
                   dn.full_name, dn.qr_code, bt.code AS blood_type_code, bc.name AS component_name,
                   bb.name AS bank_name, ph.full_name AS phlebotomist_name, dv.title AS drive_title
            FROM donation d
            JOIN donor dn ON dn.donor_id = d.donor_id
            JOIN blood_type bt ON bt.blood_type_id = d.blood_type_id
            JOIN blood_component bc ON bc.component_id = d.component_id
            JOIN blood_bank bb ON bb.bank_id = d.bank_id
            LEFT JOIN phlebotomist ph ON ph.phlebotomist_id = d.phlebotomist_id
            LEFT JOIN drive dv ON dv.drive_id = d.drive_id"
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . " ORDER BY {$sortColumn} {$direction}, d.donation_id DESC";

    $stmt = $conn->prepare($sql);
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $donations = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    sendJson(true, 'Donations loaded.', ['count' => count($donations), 'donations' => $donations]);
}

/* ---------- POST: record a collection (phlebotomist, online or synced from IndexedDB) ---------- */

if ($method === 'POST') {
    requireFields($input, ['client_uuid', 'component_id', 'units']);
    $clientUuid = sanitizeString($input['client_uuid']);
    if (!preg_match('/^[0-9a-fA-F-]{36}$/', $clientUuid)) {
        sendJson(false, 'client_uuid must be a 36-character UUID.', null, 422);
    }

    // Already received (a retried sync): answer with the stored row instead of inserting twice.
    $stmt = $conn->prepare('SELECT donation_id FROM donation WHERE client_uuid = ?');
    $stmt->bind_param('s', $clientUuid);
    $stmt->execute();
    $existing = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if ($existing) {
        sendJson(true, 'Donation already recorded.', [
            'donation_id' => (int)$existing['donation_id'], 'client_uuid' => $clientUuid, 'duplicate' => true,
        ]);
    }

    $componentId = validateIntRange($input['component_id'], 1, 4, 'component_id');
    $units = validateFloatRange($input['units'], 0.25, 2, 'units');
    $collectedAt = !empty($input['collected_at'])
        ? validateDateTime((string)$input['collected_at'], 'collected_at')
        : date('Y-m-d H:i:s');
    if ($collectedAt > date('Y-m-d H:i:s', time() + 300)) {
        sendJson(false, 'collected_at cannot be in the future.', null, 422);
    }
    $driveId = !empty($input['drive_id']) ? validateIntRange($input['drive_id'], 1, PHP_INT_MAX, 'drive_id') : null;
    $phlebotomistId = signedInPhlebotomistId($conn);

    // Online scans send donor_id; a record queued offline may only know the scanned QR code.
    if (!empty($input['donor_id'])) {
        $donorKey = validateIntRange($input['donor_id'], 1, PHP_INT_MAX, 'donor_id');
        $stmt = $conn->prepare('SELECT * FROM donor WHERE donor_id = ?');
        $stmt->bind_param('i', $donorKey);
    } else {
        requireFields($input, ['qr_code']);
        $qrCode = sanitizeString($input['qr_code']);
        $stmt = $conn->prepare('SELECT * FROM donor WHERE qr_code = ?');
        $stmt->bind_param('s', $qrCode);
    }
    $stmt->execute();
    $donor = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$donor) {
        sendJson(false, 'Donor not found.', null, 404);
    }
    $donorId = (int)$donor['donor_id'];

    // The scanner shows eligibility, but the server decides (the record may have waited offline).
    $eligibility = donorEligibility($conn, $donor);
    if (!$eligibility['is_eligible']) {
        sendJson(false, 'Donor is not eligible: ' . implode(' ', $eligibility['reasons']), $eligibility, 422);
    }

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare(
            "INSERT INTO donation (client_uuid, donor_id, bank_id, drive_id, blood_type_id, component_id,
                                   phlebotomist_id, units, collected_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'collected')"
        );
        $bloodTypeId = (int)$donor['blood_type_id'];
        $stmt->bind_param('siiiiiids', $clientUuid, $donorId, $bankId, $driveId, $bloodTypeId,
            $componentId, $phlebotomistId, $units, $collectedAt);
        $stmt->execute();
        $donationId = (int)$stmt->insert_id;
        $stmt->close();

        refreshLastDonationDate($conn, $donorId);
        $conn->commit();
    } catch (mysqli_sql_exception $e) {
        $conn->rollback();
        if ($e->getCode() === 1062) { // the same record arrived twice at once
            sendJson(true, 'Donation already recorded.', ['client_uuid' => $clientUuid, 'duplicate' => true]);
        }
        throw $e;
    }

    sendJson(true, 'Donation recorded.', ['donation_id' => $donationId, 'client_uuid' => $clientUuid], 201);
}

/* ---------- PUT: bank updates units / status ---------- */

if ($method === 'PUT') {
    requireFields($input, ['donation_id']);
    $donationId = validateIntRange($input['donation_id'], 1, PHP_INT_MAX, 'donation_id');
    $own = requireOwnDonation($conn, $donationId, $bankId);

    // Omitted fields keep their stored value.
    $units = ($input['units'] ?? '') !== '' ? validateFloatRange($input['units'], 0.25, 2, 'units') : null;
    $status = ($input['status'] ?? '') !== '' ? validateEnum((string)$input['status'], DONATION_STATUSES, 'status') : null;
    if ($units === null && $status === null) {
        sendJson(false, 'Provide units or status to update.', null, 422);
    }

    $stmt = $conn->prepare('UPDATE donation SET units = COALESCE(?, units), status = COALESCE(?, status) WHERE donation_id = ?');
    $stmt->bind_param('dsi', $units, $status, $donationId);
    $stmt->execute();
    $stmt->close();
    refreshLastDonationDate($conn, (int)$own['donor_id']); // a discarded unit no longer counts

    sendJson(true, 'Donation updated.', ['donation_id' => $donationId]);
}

/* ---------- DELETE: bank removes a donation ---------- */

if ($method === 'DELETE') {
    requireFields($input, ['donation_id']);
    $donationId = validateIntRange($input['donation_id'], 1, PHP_INT_MAX, 'donation_id');
    $own = requireOwnDonation($conn, $donationId, $bankId);

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare('DELETE FROM donation WHERE donation_id = ?'); // blood_history.donation_id is SET NULL by its FK
        $stmt->bind_param('i', $donationId);
        $stmt->execute();
        $stmt->close();
        refreshLastDonationDate($conn, (int)$own['donor_id']);
        $conn->commit();
    } catch (mysqli_sql_exception $e) {
        $conn->rollback();
        throw $e;
    }

    sendJson(true, 'Donation deleted.', ['donation_id' => $donationId]);
}
