// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

library console2 {
    address constant CONSOLE_ADDRESS = 0x000000000000000000636F6e736F6c652e6c6f67;

    function _castLogPayloadViewToPure(function(bytes memory) internal view fnIn)
        internal pure returns (function(bytes memory) internal pure fnOut) {
        assembly { fnOut := fnIn }
    }

    function _sendLogPayload(bytes memory b) internal pure {
        _castLogPayloadViewToPure(_sendLogPayloadView)(b);
    }

    function _sendLogPayloadView(bytes memory b) private view {
        uint256 payloadLength = b.length;
        address consoleAddress = CONSOLE_ADDRESS;
        assembly {
            let v := staticcall(gas(), consoleAddress, add(b, 32), payloadLength, 0, 0)
        }
    }

    function log(string memory value) internal pure {
        _sendLogPayload(abi.encodeWithSignature("log(string)", value));
    }

    function log(address value) internal pure {
        _sendLogPayload(abi.encodeWithSignature("log(address)", value));
    }

    function log(uint256 value) internal pure {
        _sendLogPayload(abi.encodeWithSignature("log(uint256)", value));
    }

    function log(string memory p0, address p1) internal pure {
        _sendLogPayload(abi.encodeWithSignature("log(string,address)", p0, p1));
    }

    function log(string memory p0, uint256 p1) internal pure {
        _sendLogPayload(abi.encodeWithSignature("log(string,uint256)", p0, p1));
    }
}
