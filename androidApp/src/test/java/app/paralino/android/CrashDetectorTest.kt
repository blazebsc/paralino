package app.paralino.android

import app.paralino.android.safety.CrashDetector
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Synthetic driving scenarios for the crash state machine.
 * The roller-coaster case is the one the user explicitly cares about.
 */
class CrashDetectorTest {

    private var now = 0L
    private var escalatedCount = 0
    private val detector = CrashDetector { escalatedCount++ }

    private fun tick(ms: Long) { now += ms }
    private fun speed(mps: Float, lat: Double = 51.0, lng: Double = 5.0) =
        detector.onLocationSample(mps, lat, lng, now)

    private fun accel(g: Float) = detector.onAccelerometerSample(g * CrashDetector.GRAVITY, now)

    private fun driveAt(mps: Float, seconds: Int) {
        repeat(seconds * 2) {
            speed(mps)
            detector.onSpeedSample(mps)
            accel(1.0f) // steady 1g while cruising
            tick(500)
        }
    }

    /** walk-up: never reaches driving speed — must never arm */
    @Test
    fun phoneDropAtWalkingPace_neverArms() {
        repeat(120) { // 60s of walking
            speed(1.5f)
            accel(6.0f) // would be a huge impact if armed
            tick(500)
        }
        assertFalse(detector.isArmed)
        assertEquals(0, escalatedCount)
    }

    /** the flagship false-positive: high G oscillations at speed, but the
     *  ride keeps moving — no delta-v, no stillness */
    @Test
    fun rollerCoaster_doesNotEscalate() {
        driveAt(12f, 35) // arm: ~43 km/h sustained
        assertTrue(detector.isArmed)
        // 60s of coaster: violent G swings (0.2g..4g) while still moving 10-15 m/s
        var g = 1.0f
        repeat(120) {
            g = if (g > 2f) 0.3f else 3.8f // oscillate between near-freefall and 3.8g
            speed(if (g > 2f) 15f else 11f) // ride keeps moving
            accel(g)
            // position keeps changing fast (ride travels ~10m/500ms)
            tick(500)
            detector.onLocationSample(
                speedMps = if (g > 2f) 15f else 11f,
                lat = 51.0 + (it * 0.0001), // ~10m per sample
                lng = 5.0,
                timeMs = now
            )
        }
        assertEquals(0, escalatedCount)
    }

    /** hard braking: delta-v happens but the car drives on — no stillness */
    @Test
    fun hardBraking_doesNotEscalate() {
        driveAt(14f, 35)
        assertTrue(detector.isArmed)
        // brake hard: 14 -> 3 m/s in 3s, with a jolt
        accel(4.0f); tick(200)
        detector.onSpeedSample(14f)
        speed(3f); tick(1000)
        speed(3f); tick(1000)
        // then keep driving for a while (position drifts fast)
        repeat(40) {
            speed(8f)
            tick(500)
            detector.onLocationSample(8f, 51.0 + (it * 0.0002), 5.0, now)
        }
        assertEquals(0, escalatedCount)
    }

    /** the real thing: impact, sharp velocity drop, then stillness */
    @Test
    fun realCrash_escalates() {
        driveAt(14f, 35) // ~50 km/h
        assertTrue(detector.isArmed)
        // wall: impact jolt
        accel(4.2f); tick(150)
        detector.onSpeedSample(14f)
        // speed collapses
        speed(2f); tick(1000)
        // car sits still (tiny drift) for the stillness window
        var i = 0
        while (!detector.hasEscalated && i < 60) {
            speed(0.5f)
            tick(500)
            detector.onLocationSample(0.5f, 51.0 + (i * 1e-7), 5.0, now) // centimeter drift
            i++
        }
        assertTrue(detector.hasEscalated)
        assertTrue(escalatedCount > 0)
    }

    /** impact at speed but the car keeps rolling (fender bender) — no stillness, no escalation */
    @Test
    fun impactWithoutStillness_doesNotEscalate() {
        driveAt(14f, 35)
        accel(4.5f); tick(150)
        detector.onSpeedSample(14f)
        speed(10f); tick(1000) // barely slowed
        repeat(40) {
            speed(10f)
            tick(500)
            detector.onLocationSample(10f, 51.0 + (it * 0.0002), 5.0, now)
        }
        assertEquals(0, escalatedCount)
    }

    private fun assertEquals(expected: Int, actual: Int) =
        org.junit.Assert.assertEquals(expected, actual)
}
