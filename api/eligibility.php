<?php
// this is eligibility.php - evaluates donor eligibility based on deferrals, last donation date, age, and weight
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

function evaluateDonorEligibility(array $donor, array $activeDeferrals = [], array$vitals = []): array {
    $reasons = [];$cooldownDays = 56; 

    $isDeferred = count($activeDeferrals) > 0;
    if ($isDeferred) {
        foreach ($activeDeferrals as $def) {$reasons[] = "Deferred: {$def['reason']} (Until: " . ($def['ends_on'] ?? 'Indefinite') . ")";
        }
    }

    $lastDonationDate =$donor['last_donation_date'] ?? null;
    $daysSinceLast = null;
    $daysUntilEligible = 0;
    $nextEligibleDate = date('Y-m-d');$passedCooldown = true;

    if (!empty($lastDonationDate) &&$lastDonationDate !== '0000-00-00') {
        $lastDt = new DateTime($lastDonationDate);
        $todayDt = new DateTime(date('Y-m-d'));$diff = $todayDt->diff($lastDt);
        $daysSinceLast = ($todayDt >= $lastDt) ? (int)$diff->days : 0;
        $nextEligibleDate = (clone $lastDt)->modify("+{$cooldownDays} days")->format('Y-m-d');

        if ($daysSinceLast < $cooldownDays) {$passedCooldown = false;
            $daysUntilEligible = $cooldownDays -$daysSinceLast;
            $reasons[] = "Cooldown active: {$daysUntilEligible} day(s) remaining (eligible on {$nextEligibleDate}).";
        }
    }

    $age = null;
    $passedAge = true;
    if (!empty($donor['birthdate'])) {
        $birthDt = new DateTime($donor['birthdate']);
        $age = (new DateTime(date('Y-m-d')))->diff($birthDt)->y;
        if ($age < 16 || $age > 65) {$passedAge = false;
            $reasons[] = "Age requirement not met ({$age} yrs old; must be 16–65).";
        }
    }

    $weightKg = (float)($donor['weight_kg'] ?? 0);
    $passedWeight =$weightKg >= 50.0;
    if (!$passedWeight) {$reasons[] = "Weight below minimum ({$weightKg} kg).";
    }

    $isEligible = !$isDeferred &&$passedCooldown && $passedAge &&$passedWeight;

    return [
        'is_eligible' => $isEligible,
        'status_label' => $isEligible ? 'Eligible' : 'Deferred',
        'age' => $age,
        'reasons' => $reasons
    ];
}

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'eligibility.php') {$conn = getDbConnection();
    $input = getRequestData();$donorId = isset($input['donor_id']) ? (int)$input['donor_id'] : 0;
    $qrCode = sanitizeString($input['qr_code'] ?? '');

    if ($donorId <= 0 &&$qrCode === '') {
        sendJson(false, 'Provide donor_id or qr_code.', null, 422);
    }

    $sql = "SELECT d.*, bt.code as blood_type_code FROM donor d JOIN blood_type bt ON d.blood_type_id = bt.blood_type_id WHERE " . ($donorId > 0 ? "d.donor_id = ?" : "d.qr_code = ?");
    $stmt =$conn->prepare($sql);$donorId > 0 ? $stmt->bind_param('i',$donorId) : $stmt->bind_param('s',$qrCode);
    $stmt->execute();$donor = $stmt->get_result()->fetch_assoc();$stmt->close();

    if (!$donor) sendJson(false, 'Donor not found.', null, 404);

    $stmtDef =$conn->prepare("SELECT reason, ends_on FROM donor_deferral WHERE donor_id = ? AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)");
    $stmtDef->bind_param('i',$donor['donor_id']);
    $stmtDef->execute();$deferrals = $stmtDef->get_result()->fetch_all(MYSQLI_ASSOC);$stmtDef->close();

    sendJson(true, 'Eligibility evaluated.', [
        'donor' => $donor,
        'eligibility' => evaluateDonorEligibility($donor,$deferrals)
    ]);
}
