<?php
declare(strict_types=1);

require_once __DIR__ . '/validation.php';

function evaluateDonorEligibility(array $donor, array $vitals = []): array {
    $reasons = [];
    $cooldownDays = 56; 

    $isDeferred = !empty($donor['is_deferred']) && (int)$donor['is_deferred'] === 1;
    if ($isDeferred) {
        $reasonText = !empty($donor['deferral_reason']) ? $donor['deferral_reason'] : 'Active medical/screening deferral on file.';
        $reasons[] = "Deferred: {$reasonText}";
    }

    $lastDonationDate = $donor['last_donation_date'] ?? null;
    $daysSinceLast = null;
    $daysUntilEligible = 0;
    $nextEligibleDate = date('Y-m-d');
    $passedCooldown = true;

    if (!empty($lastDonationDate) && $lastDonationDate !== '0000-00-00') {
        $lastDt = new DateTime($lastDonationDate);
        $todayDt = new DateTime(date('Y-m-d'));
        $diff = $todayDt->diff($lastDt);
        $daysSinceLast = ($todayDt >= $lastDt) ? (int)$diff->days : 0;

        $nextDt = (clone $lastDt)->modify("+{$cooldownDays} days");
        $nextEligibleDate = $nextDt->format('Y-m-d');

        if ($daysSinceLast < $cooldownDays) {
            $passedCooldown = false;
            $daysUntilEligible = $cooldownDays - $daysSinceLast;
            $reasons[] = "Cooldown active: {$daysUntilEligible} day(s) remaining (eligible on {$nextEligibleDate}).";
        }
    }

    $age = null;
    $passedAge = true;
    if (!empty($donor['birth_date']) && $donor['birth_date'] !== '0000-00-00') {
        $birthDt = new DateTime($donor['birth_date']);
        $todayDt = new DateTime(date('Y-m-d'));
        $age = $todayDt->diff($birthDt)->y;
        if ($age < 16 || $age > 65) {
            $passedAge = false;
            $reasons[] = "Age requirement not met ({$age} yrs old; must be 16–65).";
        }
    }

    $weightKg = isset($vitals['weight_kg']) ? (float)$vitals['weight_kg'] : (isset($donor['weight_kg']) ? (float)$donor['weight_kg'] : null);
    $passedWeight = true;
    if ($weightKg !== null && $weightKg < 50.0) {
        $passedWeight = false;
        $reasons[] = "Weight below minimum threshold ({$weightKg} kg; minimum is 50 kg).";
    }

    $passedHemoglobin = true;
    if (isset($vitals['hemoglobin_g_dl']) && $vitals['hemoglobin_g_dl'] !== '') {
        $hb = (float)$vitals['hemoglobin_g_dl'];
        $sex = strtolower((string)($donor['sex'] ?? 'male'));
        $minHb = ($sex === 'female' || $sex === 'f') ? 12.5 : 13.0;

        if ($hb < $minHb) {
            $passedHemoglobin = false;
            $reasons[] = "Hemoglobin too low ({$hb} g/dL; minimum required is {$minHb} g/dL).";
        }
    }

    $passedPulse = true;
    if (isset($vitals['pulse_bpm']) && $vitals['pulse_bpm'] !== '') {
        $pulse = (int)$vitals['pulse_bpm'];
        if ($pulse < 50 || $pulse > 100) {
            $passedPulse = false;
            $reasons[] = "Pulse outside normal range ({$pulse} bpm; must be 50–100 bpm).";
        }
    }

    $isEligible = !$isDeferred && $passedCooldown && $passedAge && $passedWeight && $passedHemoglobin && $passedPulse;

    return [
        'is_eligible' => $isEligible,
        'status_label' => $isEligible ? 'Eligible' : 'Deferred',
        'days_since_last_donation' => $daysSinceLast,
        'days_until_eligible' => $daysUntilEligible,
        'next_eligible_date' => $nextEligibleDate,
        'age' => $age,
        'checks' => [
            'not_deferred' => !$isDeferred,
            'passed_cooldown' => $passedCooldown,
            'passed_age' => $passedAge,
            'passed_weight' => $passedWeight,
            'passed_hb' => $passedHemoglobin,
            'passed_pulse' => $passedPulse
        ],
        'reasons'                  => $reasons
    ];
}

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'eligibility.php') {
    $conn = getDbConnection();
    $input = getRequestData();

    $donorId = isset($input['donor_id']) ? (int)$input['donor_id'] : 0;
    $qrToken = sanitizeString($input['qr_token'] ?? ($input['qr_code'] ?? ''));

    if ($donorId <= 0 && $qrToken === '') {
        sendJson(false, 'Provide either donor_id or qr_token to check eligibility.', null, 422);
    }

    if ($donorId > 0) {
        $stmt = $conn->prepare("SELECT * FROM donors WHERE donor_id = ? LIMIT 1");
        $stmt->bind_param('i', $donorId);
    } else {
        $stmt = $conn->prepare("SELECT * FROM donors WHERE qr_token = ? LIMIT 1");
        $stmt->bind_param('s', $qrToken);
    }

    $stmt->execute();
    $result = $stmt->get_result();
    $donor = $result->fetch_assoc();
    $stmt->close();

    if (!$donor) {
        sendJson(false, 'Donor not found.', null, 404);
    }

    $eligibility = evaluateDonorEligibility($donor, $input);

    sendJson(true, 'Eligibility evaluated successfully.', [
        'donor' => $donor,
        'eligibility' => $eligibility
    ]);
}
