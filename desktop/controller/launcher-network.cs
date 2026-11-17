using System;
using System.Linq;
using System.Collections.Generic;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.RegularExpressions;

public sealed class RoutineLanAddress {
    public string Address { get; set; }
    public string Name { get; set; }
    public int Priority { get; set; }
    public string Label { get { return Name + " | " + Address; } }
    public string Url { get { return "http://" + Address + ":3000"; } }
}

public static class RoutineLan {
    public static bool IsUsableIPv4(string value) {
        IPAddress address;
        if(value==null || !Regex.IsMatch(value,@"^\d{1,3}(\.\d{1,3}){3}$") || !IPAddress.TryParse(value,out address) || address.AddressFamily!=AddressFamily.InterNetwork)return false;
        byte[] bytes=address.GetAddressBytes();
        return bytes[0]!=0 && bytes[0]!=127 && bytes[0]<224 && !(bytes[0]==169 && bytes[1]==254);
    }
    public static RoutineLanAddress[] Sort(IEnumerable<RoutineLanAddress> list) {
        return list.Where(a=>IsUsableIPv4(a.Address)).OrderBy(a=>a.Priority).ThenBy(a=>a.Name,StringComparer.OrdinalIgnoreCase).ThenBy(a=>a.Address,StringComparer.Ordinal).GroupBy(a=>a.Address).Select(g=>g.First()).ToArray();
    }
    public static RoutineLanAddress[] GetAddresses() {
        var list=new List<RoutineLanAddress>();
        foreach(var nic in NetworkInterface.GetAllNetworkInterfaces()) {
            if(nic.OperationalStatus!=OperationalStatus.Up || nic.NetworkInterfaceType==NetworkInterfaceType.Loopback || nic.NetworkInterfaceType==NetworkInterfaceType.Tunnel)continue;
            try {
                var info=nic.GetIPProperties();
                bool gateway=info.GatewayAddresses.Any(g=>g.Address.AddressFamily==AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                bool virtualLink=Regex.IsMatch(nic.Name+" "+nic.Description,"virtual|hyper-v|vmware|vpn|wireguard|tailscale|docker|wsl|cloudflare|warp|zerotier",RegexOptions.IgnoreCase);
                int score=(nic.NetworkInterfaceType==NetworkInterfaceType.Wireless80211?0:nic.NetworkInterfaceType==NetworkInterfaceType.Ethernet?5:15)+(gateway?0:20)+(virtualLink?50:0);
                foreach(var unicast in info.UnicastAddresses) {
                    string ip=unicast.Address.ToString();
                    if(IsUsableIPv4(ip))list.Add(new RoutineLanAddress {Address=ip,Name=nic.Name,Priority=score});
                }
            }catch(NetworkInformationException){} // One unavailable adapter must not hide the other networks.
        }
        return Sort(list);
    }
}
