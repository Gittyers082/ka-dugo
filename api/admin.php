<?php
// this is admin.php - platform oversight for the admin role
//   GET ?view=summary   totals per status, per bank and per organizer
//   GET ?view=accounts  every account with its display name (?role=, ?search=, ?sort=, ?dir=)
//   PUT                 activate / deactivate one account (is_active) - no account creation (Task Guide 5a)
// The donation records themselves come from donations.php, which admins may read across all banks.
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

const ACCOUNT_ROLES = ['donor', 'bank', 'phlebotomist', 'organizer', 'admin'];
const ACCOUNT_SORTS = ['email' => 'a.email', 'role' => 'a.role', 'name' => 'display_name', 'last_login' => 'a.last_login'];

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
header('Cache-Control: no-store');

$adminAccountId = requireRole(['admin']);

if ($method === 'GET' && ($input['view'] ?? '') === 'summary') {
    $byStatus = $conn->query(
        'SELECT status, COUNT(*) AS donations, COALESCE(SUM(units), 0) AS units FROM donation GROUP BY status'
    )->fetch_all(MYSQLI_ASSOC);

    $banks = $conn->query(
        "SELECT b.bank_id, b.name, b.daily_quota_units,
                (SELECT COUNT(*) FROM donation d WHERE d.bank_id = b.bank_id) AS donations,
                (SELECT COALESCE(SUM(d.units), 0) FROM donation d WHERE d.bank_id = b.bank_id AND d.status <> 'discarded') AS units,
                (SELECT COUNT(*) FROM donation d WHERE d.bank_id = b.bank_id AND DATE(d.collected_at) = CURDATE()) AS today,
                (SELECT COUNT(*) FROM blood_request r WHERE r.bank_id = b.bank_id AND r.status = 'open') AS open_requests,
                (SELECT COUNT(*) FROM phlebotomist p WHERE p.bank_id = b.bank_id) AS phlebotomists
         FROM blood_bank b ORDER BY b.name"
    )->fetch_all(MYSQLI_ASSOC);

    $organizers = $conn->query(
        "SELECT o.organizer_id, o.org_name,
                (SELECT COUNT(*) FROM drive d WHERE d.organizer_id = o.organizer_id) AS drives,
                (SELECT COUNT(*) FROM drive d WHERE d.organizer_id = o.organizer_id AND d.status IN ('scheduled', 'ongoing')) AS upcoming,
                (SELECT COUNT(*) FROM drive_registration r JOIN drive d ON d.drive_id = r.drive_id
                 WHERE d.organizer_id = o.organizer_id AND r.status <> 'cancelled') AS registrations,
                (SELECT COUNT(*) FROM alert a WHERE a.organizer_id = o.organizer_id AND a.status = 'active') AS alerts
         FROM organizer o ORDER BY o.org_name"
    )->fetch_all(MYSQLI_ASSOC);

    $accounts = $conn->query(
        'SELECT role, COUNT(*) AS total, SUM(is_active) AS active FROM account GROUP BY role'
    )->fetch_all(MYSQLI_ASSOC);

    sendJson(true, 'Summary loaded.', [
        'by_status' => $byStatus,
        'banks' => $banks,
        'organizers' => $organizers,
        'accounts' => $accounts,
    ]);
}

if ($method === 'GET' && ($input['view'] ?? '') === 'accounts') {
    $where = [];
    $types = '';
    $params = [];
    if (!empty($input['role'])) {
        $where[] = 'a.role = ?';
        $types .= 's';
        $params[] = validateEnum((string)$input['role'], ACCOUNT_ROLES, 'role');
    }
    $search = sanitizeString($input['search'] ?? '');
    if ($search !== '') {
        $where[] = '(a.email LIKE ? OR COALESCE(dn.full_name, o.org_name, b.name, p.full_name, \'\') LIKE ?)';
        $like = "%{$search}%";
        $types .= 'ss';
        array_push($params, $like, $like);
    }
    $sort = ACCOUNT_SORTS[$input['sort'] ?? 'role'] ?? ACCOUNT_SORTS['role'];
    $direction = strtolower((string)($input['dir'] ?? 'asc')) === 'desc' ? 'DESC' : 'ASC';

    $stmt = $conn->prepare(
        "SELECT a.account_id, a.email, a.role, a.is_active, a.last_login,
                COALESCE(dn.full_name, o.org_name, b.name, p.full_name, 'Ka-dugo Administration') AS display_name,
                COALESCE(pb.name, '') AS bank_name
         FROM account a
         LEFT JOIN donor dn ON dn.account_id = a.account_id
         LEFT JOIN organizer o ON o.account_id = a.account_id
         LEFT JOIN blood_bank b ON b.account_id = a.account_id
         LEFT JOIN phlebotomist p ON p.account_id = a.account_id
         LEFT JOIN blood_bank pb ON pb.bank_id = p.bank_id"
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . " ORDER BY {$sort} {$direction}, a.email"
    );
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $accounts = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    sendJson(true, 'Accounts loaded.', ['count' => count($accounts), 'accounts' => $accounts]);
}

if ($method === 'PUT') {
    $accountId = validateIntRange($input['account_id'] ?? null, 1, PHP_INT_MAX, 'account_id');
    $isActive = validateIntRange($input['is_active'] ?? null, 0, 1, 'is_active');
    if ($accountId === $adminAccountId) {
        sendJson(false, 'You cannot deactivate your own account.', null, 422);
    }

    $check = $conn->prepare('SELECT 1 FROM account WHERE account_id = ?');
    $check->bind_param('i', $accountId);
    $check->execute();
    $exists = (bool)$check->get_result()->fetch_assoc();
    $check->close();
    if (!$exists) {
        sendJson(false, 'Account not found.', null, 404);
    }

    // A deactivated account is signed out on its next request (requireRole checks is_active).
    $stmt = $conn->prepare('UPDATE account SET is_active = ? WHERE account_id = ?');
    $stmt->bind_param('ii', $isActive, $accountId);
    $stmt->execute();
    $stmt->close();

    sendJson(true, $isActive ? 'Account activated.' : 'Account deactivated.', [
        'account_id' => $accountId,
        'is_active' => $isActive,
    ]);
}

sendJson(false, 'Unknown admin request.', null, 400);
