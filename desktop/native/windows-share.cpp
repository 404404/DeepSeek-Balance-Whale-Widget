#include <windows.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <winrt/Windows.ApplicationModel.DataTransfer.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Storage.h>
#include <winrt/base.h>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cwchar>
#include <string>
#include <thread>
#include <vector>

using namespace winrt;
using namespace Windows::ApplicationModel::DataTransfer;
using namespace Windows::Storage;
using namespace Windows::Foundation::Collections;

static std::atomic<bool> g_dataReady{false};
static std::atomic<bool> g_shareEnded{false};
static HANDLE g_done = nullptr;

fire_and_forget set_share_items(DataRequest request, DataRequestDeferral deferral, std::vector<std::wstring> paths) {
  try {
    auto files = single_threaded_vector<IStorageItem>();
    for (const auto& path : paths) {
      auto file = co_await StorageFile::GetFileFromPathAsync(path);
      files.Append(file.as<IStorageItem>());
    }
    request.Data().Properties().Title(L"AI Balance Whale 文件分享");
    request.Data().SetStorageItems(files);
  } catch (...) {
    try { request.FailWithDisplayText(L"无法读取所选文件，请确认文件仍存在且当前账户有权访问。"); } catch (...) {}
  }
  g_dataReady.store(true);
  SetEvent(g_done);
  deferral.Complete();
}

static void emit_error(const char* code, HRESULT hr) {
  std::printf("{\"status\":\"error\",\"code\":\"%s\",\"hresult\":%ld}\n", code, static_cast<long>(hr));
  std::fflush(stdout);
}

int wmain() {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv || argc < 3) { if (argv) LocalFree(argv); emit_error("invalid-arguments", E_INVALIDARG); return 2; }
  HWND owner = reinterpret_cast<HWND>(std::wcstoull(argv[1], nullptr, 16));
  std::vector<std::wstring> paths;
  for (int i = 2; i < argc; ++i) paths.emplace_back(argv[i]);
  LocalFree(argv);
  if (!IsWindow(owner) || paths.empty()) { emit_error("invalid-owner", E_INVALIDARG); return 2; }

  try {
    init_apartment(apartment_type::single_threaded);
    g_done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!g_done) { emit_error("event-create-failed", HRESULT_FROM_WIN32(GetLastError())); return 3; }
    auto interop = get_activation_factory<DataTransferManager, IDataTransferManagerInterop>();
    DataTransferManager manager{nullptr};
    check_hresult(interop->GetForWindow(owner, guid_of<DataTransferManager>(), put_abi(manager)));
    auto registration = manager.DataRequested([paths](DataTransferManager const&, DataRequestedEventArgs const& args) {
      auto request = args.Request();
      auto data = request.Data();
      data.ShareCompleted([](DataPackage const&, ShareCompletedEventArgs const&) { g_shareEnded.store(true); SetEvent(g_done); });
      data.ShareCanceled([](DataPackage const&, IInspectable const&) { g_shareEnded.store(true); SetEvent(g_done); });
      set_share_items(request, request.GetDeferral(), paths);
    });
    // Completion/cancellation only releases this helper's event subscription;
    // it does not prove that a remote service delivered or retained the file.
    check_hresult(interop->ShowShareUIForWindow(owner));
    std::puts("{\"status\":\"opened\"}");
    std::fflush(stdout);

    const auto started = GetTickCount64();
    while ((!g_shareEnded.load() || !g_dataReady.load()) && GetTickCount64() - started < 10ULL * 60ULL * 1000ULL) {
      MSG message{};
      while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
        if (message.message == WM_QUIT) { PostQuitMessage(static_cast<int>(message.wParam)); break; }
        TranslateMessage(&message); DispatchMessageW(&message);
      }
      MsgWaitForMultipleObjects(1, &g_done, FALSE, 40, QS_ALLINPUT);
      if (g_dataReady.load()) ResetEvent(g_done);
    }
    manager.DataRequested(registration);
    CloseHandle(g_done); g_done = nullptr;
    uninit_apartment();
    return 0; // The native API cannot prove that a selected target sent the item.
  } catch (hresult_error const& error) {
    emit_error("windows-share-api-failed", error.code());
    if (g_done) CloseHandle(g_done);
    return 4;
  } catch (...) {
    emit_error("windows-share-failed", E_FAIL);
    if (g_done) CloseHandle(g_done);
    return 5;
  }
}
