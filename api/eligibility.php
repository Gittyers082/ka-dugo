<?php
// this is eligibility.php - shared donor eligibility rules (deferrals, 56-day interval, age, weight)
// Included by donors.php, donations.php, alerts.php and donor_portal.php; it is not an endpoint itself.
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

const DONATION_INTERVAL_DAYS = 56;
const MIN_DONOR_AGE = 16;
const MAX_DONOR_AGE = 65;
const MIN_DONOR_WEIGHT_KG = 50.0;

function evaluateDonorEligibility(array $donor, array $activeDeferrals = []): array {
    $reasons = [];
    $today = new DateTime(date('Y-m-d'));

    foreach ($activeDeferrals as $deferral) {
        $reasons[] = "Deferred: {$deferral['reason']} (until " . ($deferral['ends_on'] ?? 'further notice') . ').';
    }

    $passedInterval = true;
    $lastDonation = $donor['last_donation_date'] ?? null;
    if (!empty($lastDonation) && $lastDonation !== '0000-00-00') {
        $lastDate = new DateTime($lastDonation);
        $daysSince = $today >= $lastDate ? (int)$today->diff($lastDate)->days : 0;
        if ($daysSince < DONATION_INTERVAL_DAYS) {
            $passedInterval = false;
            $nextDate = (clone $lastDate)->modify('+' . DONATION_INTERVAL_DAYS . ' days')->format('Y-m-d');
            $daysLeft = DONATION_INTERVAL_DAYS - $daysSince;
            $reasons[] = "Donation interval: {$daysLeft} day(s) remaining (eligible on {$nextDate}).";
        }
    }

    $age = null;
    $passedAge = true;
    if (!empty($donor['birthdate'])) {
        $age = $today->diff(new DateTime($donor['birthdate']))->y;
        if ($age < MIN_DONOR_AGE || $age > MAX_DONOR_AGE) {
            $passedAge = false;
            $reasons[] = "Age requirement not met ({$age} years old; must be " . MIN_DONOR_AGE . '–' . MAX_DONOR_AGE . ').';
        }
    }

    $weight = (float)($donor['weight_kg'] ?? 0);
    $passedWeight = $weight >= MIN_DONOR_WEIGHT_KG;
    if (!$passedWeight) {
        $reasons[] = "Weight below minimum ({$weight} kg; must be at least " . MIN_DONOR_WEIGHT_KG . ' kg).';
    }

    $isEligible = !$activeDeferrals && $passedInterval && $passedAge && $passedWeight;

    return [
        'is_eligible' => $isEligible,
        'status_label' => $isEligible ? 'Eligible' : 'Deferred',
        'age' => $age,
        'reasons' => $reasons,
    ];
}

// Loads the donor's active deferrals and evaluates them.
function donorEligibility(mysqli $conn, array $donor): array {
    $donorId = (int)$donor['donor_id'];
    $stmt = $conn->prepare(
        'SELECT reason, ends_on FROM donor_deferral
         WHERE donor_id = ? AND starts_on <= CURRENT_DATE AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)'
    );
    $stmt->bind_param('i', $donorId);
    $stmt->execute();
    $deferrals = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    return evaluateDonorEligibility($donor, $deferrals);
}
