using System;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

// A Windows Job owns the dedicated Routine browser and all its child processes.
// Windows also closes the job if the launcher exits unexpectedly.
public sealed class RoutineBrowser : IDisposable {
    IntPtr job, process;
    int pid;
    [StructLayout(LayoutKind.Sequential)] struct StartupInfo {
        public int cb; public IntPtr reserved, desktop, title; public int x,y,xSize,ySize,xChars,yChars,fill,flags;
        public short show, reserved2; public IntPtr reservedPtr,stdin,stdout,stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long processTime,jobTime; public uint flags; public UIntPtr min,max;
        public uint active; public UIntPtr affinity; public uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimits limits,uint size);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,System.Text.StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupInfo startup,out ProcessInfo info);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window,int command);
    public bool IsRunning { get { return process!=IntPtr.Zero && WaitForSingleObject(process,0)==258; } }
    public RoutineBrowser(string executable,string args,string cwd) {
        job=CreateJobObject(IntPtr.Zero,null);
        if(job==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
        var limits=new ExtendedLimits();limits.basic.flags=0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))){Dispose();throw new System.ComponentModel.Win32Exception();}
        var startup=new StartupInfo();startup.cb=Marshal.SizeOf(startup);
        ProcessInfo info;
        if(!CreateProcess(executable,new System.Text.StringBuilder("\""+executable+"\" "+args),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,cwd,ref startup,out info)){Dispose();throw new System.ComponentModel.Win32Exception();}
        process=info.process;pid=info.pid;
        try {
            if(!AssignProcessToJobObject(job,process)){TerminateProcess(process,1);throw new System.ComponentModel.Win32Exception();}
            if(ResumeThread(info.thread)==0xffffffff){TerminateProcess(process,1);throw new System.ComponentModel.Win32Exception();}
        } catch { Dispose();throw; } finally { CloseHandle(info.thread); }
    }
    public void Activate() {
        if(!IsRunning)return;
        try { using(var p=Process.GetProcessById(pid)){var window=p.MainWindowHandle;if(window!=IntPtr.Zero){ShowWindowAsync(window,9);SetForegroundWindow(window);}} }catch{}
    }
    public void Close() {
        if(IsRunning) {
            try { using(var child=Process.GetProcessById(pid)){PostMessage(child.MainWindowHandle,0x8052,new IntPtr(0x52544e),IntPtr.Zero);child.CloseMainWindow();WaitForSingleObject(process,1000);} }catch{}
        }
        Dispose();
    }
    public void Dispose() {
        // Closing the job terminates only this dedicated browser's process tree.
        if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}
        if(process!=IntPtr.Zero){CloseHandle(process);process=IntPtr.Zero;}
    }
}

public static class RoutineProbe {
    static readonly HttpClient client=new HttpClient(new HttpClientHandler { UseProxy=false }) { Timeout=TimeSpan.FromMilliseconds(1500) };
    public static async Task<string> Check(string url,string projectId) {
        // A failed TCP connection is not evidence of an occupied port. Use the
        // operating system's actual listener table, shared with the repair worker.
        try { if(RoutinePorts.Listeners(3000).Length==0)return "free"; }
        catch { return "inspection-error"; }
        try {
            var text=await client.GetStringAsync(url+"/api/health").ConfigureAwait(false);
            if(text.Contains("\"app\":\"routine\"")) return text.Contains(projectId)?"ready":"other-project";
        }catch{}
        return "occupied";
    }
}

public static class RoutinePorts {
    [DllImport("iphlpapi.dll",SetLastError=true)] static extern uint GetExtendedTcpTable(IntPtr table,ref uint size,bool order,int family,int tableClass,uint reserved);
    public static int[] Listeners(int port) {
        var owners=new System.Collections.Generic.HashSet<int>();
        foreach(int family in new int[]{2,23}) {
            uint size=0;uint result=GetExtendedTcpTable(IntPtr.Zero,ref size,false,family,3,0);
            if(result==50||result==87)continue; // Unsupported address family.
            if(result!=122&&result!=0)throw new System.ComponentModel.Win32Exception((int)result);
            IntPtr buffer=Marshal.AllocHGlobal((int)size);
            try {
                result=GetExtendedTcpTable(buffer,ref size,false,family,3,0);
                if(result!=0)throw new System.ComponentModel.Win32Exception((int)result);
                int count=Marshal.ReadInt32(buffer),stride=family==2?24:56;
                for(int i=0;i<count;i++) {
                    int row=4+i*stride,offset=row+(family==2?8:20);
                    int localPort=(Marshal.ReadByte(buffer,offset)<<8)|Marshal.ReadByte(buffer,offset+1);
                    if(localPort==port)owners.Add(Marshal.ReadInt32(buffer,row+(family==2?20:52)));
                }
            }finally{Marshal.FreeHGlobal(buffer);}
        }
        var answer=new int[owners.Count];owners.CopyTo(answer);return answer;
    }
}

// Read only the working directory of a candidate process, never its environment.
// Used with its executable and command line to identify legacy `node server.js`.
public static class RoutineProcessInfo {
    [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CommandLineToArgvW(string line,out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    public static string ScriptPath(string command,string directory) {
        int count;var argv=CommandLineToArgvW(command,out count);
        if(argv==IntPtr.Zero)return null;
        try {
            // Only accept Node's main script, never a filename in later arguments.
            if(count<2)return null;
            string script=Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv,IntPtr.Size));
            if(script.StartsWith("-"))return null;
            return System.IO.Path.GetFullPath(System.IO.Path.IsPathRooted(script)?script:System.IO.Path.Combine(directory,script));
        }finally{LocalFree(argv);}
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicInfo {
        public IntPtr reserved,peb,reserved2,reserved3,pid,reserved4;
    }
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] buffer,int size,out IntPtr read);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsWow64Process(IntPtr process,out bool wow64);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int type,ref BasicInfo info,int size,out int length);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int type,out IntPtr info,int size,out int length);
    static byte[] Read(IntPtr process,long address,int count) {
        var bytes=new byte[count];IntPtr read;
        if(!ReadProcessMemory(process,new IntPtr(address),bytes,count,out read)||read.ToInt64()!=count)throw new InvalidOperationException("Nao foi possivel identificar a pasta do processo.");
        return bytes;
    }
    public static string Directory(int pid) {
        IntPtr process=OpenProcess(0x410,false,pid);
        if(process==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
        try {
            bool wow64;if(!IsWow64Process(process,out wow64))throw new System.ComponentModel.Win32Exception();
            int length;long peb;bool narrow=IntPtr.Size==4||wow64;
            if(IntPtr.Size==8&&wow64){IntPtr address;if(NtQueryInformationProcess(process,26,out address,IntPtr.Size,out length)!=0)throw new InvalidOperationException();peb=address.ToInt64();}
            else{var info=new BasicInfo();if(NtQueryInformationProcess(process,0,ref info,Marshal.SizeOf(info),out length)!=0)throw new InvalidOperationException();peb=info.peb.ToInt64();}
            var parameterBytes=Read(process,peb+(narrow?0x10:0x20),narrow?4:8);
            long parameters=narrow?BitConverter.ToUInt32(parameterBytes,0):BitConverter.ToInt64(parameterBytes,0);
            var dir=Read(process,parameters+(narrow?0x24:0x38),narrow?8:16);
            int count=BitConverter.ToUInt16(dir,0);
            if(count==0||count>32766||count%2!=0)throw new InvalidOperationException();
            long buffer=narrow?BitConverter.ToUInt32(dir,4):BitConverter.ToInt64(dir,8);
            return System.Text.Encoding.Unicode.GetString(Read(process,buffer,count));
        }finally{CloseHandle(process);}
    }
}
