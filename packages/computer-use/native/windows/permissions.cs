using System.Windows.Automation;

namespace CWPi.ComputerUse
{
    internal static class Permissions
    {
        internal static object GetPermissions()
        {
            bool available;
            try
            {
                Applications.Desktop();
                available = AutomationElement.RootElement != null;
            }
            catch (Failure) { available = false; }
            return Protocol.Obj("accessibility", available, "screenRecording", available, "supported", true);
        }
    }
}
