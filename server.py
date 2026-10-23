#!/usr/bin/env python3
"""
Focus Writer Server Launcher
Cross-platform HTTP server for Focus Writer
Works on Windows, macOS, and Linux
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import threading
import time
import platform
from pathlib import Path

# Configuration
PORT = 8000
HTML_FILENAME = "index.html"

def get_python_command():
    """Get the correct Python command for this platform"""
    if platform.system() == "Windows":
        return "python"
    else:
        return "python3"

def find_html_file():
    """Find the Focus Writer HTML file in the current directory"""
    current_dir = Path.cwd()
    
    # Look for the specific filename first
    html_file = current_dir / HTML_FILENAME
    if html_file.exists():
        return HTML_FILENAME
    
    # Look for any HTML file with "focus" or "writer" in the name
    for file in current_dir.glob("*.html"):
        if "focus" in file.name.lower() or "writer" in file.name.lower():
            return file.name
    
    # Look for any HTML file
    html_files = list(current_dir.glob("*.html"))
    if html_files:
        return html_files[0].name
    
    return None

def get_platform_info():
    """Get platform-specific information"""
    system = platform.system()
    if system == "Windows":
        return "Windows", "Ctrl+C"
    elif system == "Darwin":
        return "macOS", "Cmd+C"
    else:
        return "Linux", "Ctrl+C"

def open_browser(url, delay=2):
    """Open the browser after a short delay"""
    time.sleep(delay)
    print(f"🌐 Opening browser: {url}")
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"⚠️ Could not open browser automatically: {e}")
        print(f"📋 Please open this URL manually: {url}")

def check_port_available(port):
    """Check if a port is available"""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', port))
            return True
    except OSError:
        return False

def start_server():
    """Start the HTTP server"""
    try:
        # Get platform info
        platform_name, stop_command = get_platform_info()
        
        # Change to the directory containing the HTML file
        script_dir = Path(__file__).parent.absolute()
        os.chdir(script_dir)
        
        # Find the HTML file
        html_file = find_html_file()
        if not html_file:
            print("❌ No HTML file found!")
            print("Make sure your Focus Writer HTML file is in the same directory as this script.")
            print(f"Looking for: {HTML_FILENAME}")
            print(f"📁 Current directory: {script_dir}")
            input("Press Enter to exit...")
            return
        
        print(f"📁 Found HTML file: {html_file}")
        print(f"💻 Platform: {platform_name}")
        
        # Check if port is available
        if not check_port_available(PORT):
            print(f"⚠️ Port {PORT} is already in use!")
            url = f"http://localhost:{PORT}/{html_file}"
            print(f"🌐 Trying to open existing server: {url}")
            webbrowser.open(url)
            input("Press Enter to exit...")
            return
        
        # Create server
        Handler = http.server.SimpleHTTPRequestHandler
        
        # Suppress default server logs for cleaner output
        class QuietHandler(Handler):
            def log_message(self, format, *args):
                pass  # Suppress default logging
        
        try:
            with socketserver.TCPServer(("127.0.0.1", PORT), QuietHandler) as httpd:
                url = f"http://localhost:{PORT}/{html_file}"
                
                print("🚀 Focus Writer Server Starting...")
                print("=" * 60)
                print(f"📝 Server: http://localhost:{PORT}")
                print(f"📄 Focus Writer: {url}")
                print("=" * 60)
                print("✅ Server is ready!")
                print("🔗 Google Drive sync will work from this URL")
                print(f"\n💡 Platform-specific tips for {platform_name}:")
                print(f"   • Keep this window open while using Focus Writer")
                print(f"   • Press {stop_command} to stop the server")
                print("   • Browser will open automatically in 2 seconds...")
                print(f"   • If browser doesn't open, visit: {url}")
                
                # Open browser in a separate thread
                browser_thread = threading.Thread(target=open_browser, args=(url,))
                browser_thread.daemon = True
                browser_thread.start()
                
                # Start serving
                httpd.serve_forever()
                
        except OSError as e:
            print(f"❌ Server error: {e}")
            input("Press Enter to exit...")
            
    except KeyboardInterrupt:
        print(f"\n\n🛑 Server stopped by user ({stop_command})")
        print("👋 Focus Writer server closed. You can restart anytime!")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        print(f"📁 Working directory: {os.getcwd()}")
        print(f"🐍 Python version: {sys.version}")
        input("Press Enter to exit...")

def main():
    """Main entry point"""
    print("🎯 Focus Writer Cross-Platform Server")
    print("=" * 60)
    
    # Check Python version
    if sys.version_info < (3, 6):
        print("❌ This script requires Python 3.6 or higher")
        print(f"Your version: {sys.version}")
        print(f"💡 Install Python 3.6+ and run with: {get_python_command()} server.py")
        input("Press Enter to exit...")
        sys.exit(1)
    
    # Show helpful information
    print(f"🐍 Python {sys.version.split()[0]}")
    print(f"💻 Platform: {platform.system()} {platform.release()}")
    print(f"📁 Working directory: {Path.cwd()}")
    
    start_server()

if __name__ == "__main__":
    main()
