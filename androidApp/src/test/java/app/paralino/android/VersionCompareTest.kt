package app.paralino.android

import app.paralino.android.ui.settings.compareVersions
import app.paralino.android.ui.settings.parseVersion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VersionCompareTest {

    @Test
    fun `newer remote detected`() {
        assertEquals(1, compareVersions("2.7.1", "v2.8.0"))
        assertEquals(1, compareVersions("2.7.1", "v3.0"))
        assertEquals(1, compareVersions("2.7", "2.7.1"))
    }

    @Test
    fun `same version equal`() {
        assertEquals(0, compareVersions("2.7.1", "v2.7.1"))
        assertEquals(0, compareVersions("2.7", "v2.7.0"))
    }

    @Test
    fun `older remote ignored`() {
        assertEquals(-1, compareVersions("2.7.1", "v2.7.0"))
        assertEquals(-1, compareVersions("2.7.1", "v2.6.9"))
    }

    @Test
    fun `unparsable remote stays put`() {
        assertEquals(-1, compareVersions("2.7.1", ""))
        assertEquals(-1, compareVersions("2.7.1", "backend-v0.0.1"))
    }

    @Test
    fun `parse rejects garbage`() {
        assertNull(parseVersion("v2.x.1"))
        assertNull(parseVersion(""))
    }
}
