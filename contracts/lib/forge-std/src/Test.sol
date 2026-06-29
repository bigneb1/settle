// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.9.0;

import {Vm} from "./Vm.sol";
import {console2} from "./console2.sol";

abstract contract Test {
    bool public IS_TEST = true;
    bool private _failed;

    address constant private VM_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;
    Vm internal constant vm = Vm(VM_ADDRESS);

    event log(string);
    event logs(bytes);
    event log_address(address);
    event log_bytes32(bytes32);
    event log_int(int);
    event log_uint(uint);
    event log_bytes(bytes);
    event log_string(string);
    event log_named_address(string key, address val);
    event log_named_bytes32(string key, bytes32 val);
    event log_named_decimal_int(string key, int val, uint decimals);
    event log_named_decimal_uint(string key, uint val, uint decimals);
    event log_named_int(string key, int val);
    event log_named_uint(string key, uint val);
    event log_named_bytes(string key, bytes val);
    event log_named_string(string key, string val);

    modifier takeSnapshot() {
        uint256 id = vm.snapshot();
        _;
        vm.revertTo(id);
    }

    function failed() public view returns (bool) { return _failed; }

    function fail() internal virtual { _failed = true; }

    function assertTrue(bool condition) internal virtual {
        if (!condition) { emit log("Error: assertion failed"); fail(); }
    }

    function assertTrue(bool condition, string memory err) internal virtual {
        if (!condition) { emit log_named_string("Error", err); fail(); }
    }

    function assertFalse(bool condition) internal virtual { assertTrue(!condition); }
    function assertFalse(bool condition, string memory err) internal virtual { assertTrue(!condition, err); }

    function assertEq(address a, address b) internal virtual {
        if (a != b) { emit log("Error: a == b not satisfied [address]"); fail(); }
    }
    function assertEq(address a, address b, string memory err) internal virtual {
        if (a != b) { emit log_named_string("Error", err); fail(); }
    }
    function assertEq(bytes32 a, bytes32 b) internal virtual {
        if (a != b) { emit log("Error: a == b not satisfied [bytes32]"); fail(); }
    }
    function assertEq(int a, int b) internal virtual {
        if (a != b) { emit log("Error: a == b not satisfied [int]"); fail(); }
    }
    function assertEq(uint256 a, uint256 b) internal virtual {
        if (a != b) { emit log_named_uint("Expected", b); emit log_named_uint("  Actual", a); fail(); }
    }
    function assertEq(uint256 a, uint256 b, string memory err) internal virtual {
        if (a != b) { emit log_named_string("Error", err); fail(); }
    }
    function assertEq(bool a, bool b) internal virtual {
        if (a != b) { emit log("Error: a == b not satisfied [bool]"); fail(); }
    }
    function assertEq(string memory a, string memory b) internal virtual {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) { emit log("Error: a == b not satisfied [string]"); fail(); }
    }
    function assertEq(bytes memory a, bytes memory b) internal virtual {
        if (keccak256(a) != keccak256(b)) { emit log("Error: a == b not satisfied [bytes]"); fail(); }
    }

    function assertNotEq(address a, address b) internal virtual {
        if (a == b) { emit log("Error: a != b not satisfied [address]"); fail(); }
    }
    function assertNotEq(uint256 a, uint256 b) internal virtual {
        if (a == b) { emit log("Error: a != b not satisfied [uint256]"); fail(); }
    }

    function assertGt(uint256 a, uint256 b) internal virtual {
        if (a <= b) { emit log("Error: a > b not satisfied [uint]"); fail(); }
    }
    function assertGe(uint256 a, uint256 b) internal virtual {
        if (a < b) { emit log("Error: a >= b not satisfied [uint]"); fail(); }
    }
    function assertLt(uint256 a, uint256 b) internal virtual {
        if (a >= b) { emit log("Error: a < b not satisfied [uint]"); fail(); }
    }
    function assertLe(uint256 a, uint256 b) internal virtual {
        if (a > b) { emit log("Error: a <= b not satisfied [uint256]"); fail(); }
    }

    function bound(uint256 x, uint256 min, uint256 max) internal view virtual returns (uint256 result) {
        require(min <= max, "bound: min > max");
        if (x < min || x > max) {
            uint256 size = max - min + 1;
            result = min + (x % size);
        } else {
            result = x;
        }
    }

    function makeAddr(string memory name) internal virtual returns (address addr) {
        addr = address(uint160(uint256(keccak256(abi.encodePacked(name)))));
        vm.label(addr, name);
    }

    function deal(address to, uint256 give) internal virtual {
        vm.deal(to, give);
    }
}
